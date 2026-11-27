/** Run against pnpm dev:preview. Uses a synthetic request and response. */
import assert from "node:assert/strict";
import { chromium, expect } from "@playwright/test";

const base = process.env.PREVIEW_URL || "http://127.0.0.1:4317";
const preview = `
  import React from '/node_modules/.vite/deps/react.js';
  import ReactDOM from '/node_modules/.vite/deps/react-dom_client.js';
  import { ThemeProvider } from '/src/theme/index.ts';
  import { NetworksProvider } from '/src/contexts/NetworksContext.tsx';
  import { installPreviewChrome } from '/src/preview/previewChrome.ts';
  import { createPreviewTxScenario } from '/src/preview/fixtures.ts';
  import TransactionConfirmation from '/src/components/TransactionConfirmation/TransactionConfirmation.tsx';
  import '/src/index.css'; import '/src/preview/preview.css';

  installPreviewChrome();
  document.body.classList.add('preview-canvas');
  const request = createPreviewTxScenario('privateKey', 'readme-review');
  request.accountType = 'localVault';
  request.chainName = 'Ethereum Sepolia';
  request.requestChainId = request.tx.chainId = 11155111;
  const original = chrome.runtime.sendMessage;
  chrome.runtime.sendMessage = (message, cb) => {
    if (message.type !== 'prepareLocalVaultTransaction') return original(message, cb);
    const result = {success:true, envelope:JSON.stringify({v:1, id:request.id, method:'signTransaction',
      params:{from:request.tx.from, chainId:11155111, tx:'0x' + 'ab'.repeat(80)}})};
    queueMicrotask(() => cb(result));
  };
  const noop = () => {};
  ReactDOM.createRoot(document.querySelector('#preview-root')).render(React.createElement(ThemeProvider,null,
    React.createElement(NetworksProvider,null,React.createElement(TransactionConfirmation,{
      txRequest:request, accountType:'localVault', currentIndex:0, totalCount:1, isInSidePanel:true,
      onBack:noop, onConfirmed:noop, onRejected:noop, onNavigate:noop}))));
`;

async function checkButton(button) {
  await expect(button).toBeInViewport({ ratio: 1 });
  const metrics = await button.evaluate(el => {
    const range = document.createRange();
    range.selectNodeContents(el);
    const text = range.getBoundingClientRect();
    const box = el.getBoundingClientRect();
    const css = getComputedStyle(el);
    return { width: box.width, height: box.height, left: text.left - box.left,
      right: box.right - text.right, padL: parseFloat(css.paddingLeft), padR: parseFloat(css.paddingRight) };
  });
  assert.ok(metrics.height >= 44 && metrics.left >= Math.max(8, metrics.padL) - 1 &&
    metrics.right >= Math.max(8, metrics.padR) - 1, `Button label does not fit: ${JSON.stringify(metrics)}`);
  return metrics;
}

async function checkPair(reject, send) {
  const [a, b] = await Promise.all([checkButton(reject), checkButton(send)]);
  assert.ok(Math.abs(a.width - b.width) < 1 && a.height === b.height,
    `Reject is ${a.width}×${a.height}, Send is ${b.width}×${b.height}`);
  return `${b.width}×${b.height}`;
}

function appearance(button) {
  return button.evaluate(el => {
    const style = getComputedStyle(el);
    return [style.backgroundColor, style.color, style.fontWeight, style.border, style.boxShadow];
  });
}

const browser = await chromium.launch({ headless: true, channel: "chrome" });
try {
  for (const [width, height] of [[350, 338], [320, 440], [360, 600], [495, 952], [280, 480]]) {
    const page = await browser.newPage({ viewport: { width, height } });
    await page.route("**/src/preview/index.tsx*", route => route.fulfill({ contentType: "application/javascript", body: preview }));
    await page.goto(`${base}/preview/tx?canvas=1`);
    const confirm = page.getByRole("button", { name: "Confirm", exact: true });
    await expect(confirm).toBeEnabled({ timeout: 45000 });
    await confirm.click();
    const send = page.getByRole("button", { name: "Send signed transaction", exact: true });
    const reject = page.getByRole("button", { name: "Reject", exact: true });
    await expect(send).toBeDisabled();
    const size = await checkPair(reject, send);
    const primary = await send.boundingBox();
    const secondary = await reject.boundingBox();
    if (width === 350) assert.equal(primary.y, secondary.y);
    if (width === 280) assert.ok(primary.y >= secondary.y + secondary.height && primary.width === secondary.width);
    await page.evaluate(() => { document.documentElement.style.fontSize = "125%"; });
    await checkPair(reject, send);
    await page.getByRole("textbox", { name: "LocalVault signed response" }).fill("synthetic response");
    await expect(send).toBeEnabled();
    await page.mouse.move(1, 1);
    await checkPair(reject, send);
    await expect.poll(async () => {
      const [left, right] = await Promise.all([appearance(reject), appearance(send)]);
      return left.every((value, index) => value === right[index]);
    }).toBe(true);
    await page.getByRole("button", { name: "Edit", exact: true }).click();
    await expect(confirm).toBeEnabled();
    console.log(`${width}×${height}: both buttons ${size}, also equal at 125% text`);
    await page.close();
  }
} finally {
  await browser.close();
}
