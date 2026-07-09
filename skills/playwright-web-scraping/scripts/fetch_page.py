#!/usr/bin/env python3
"""Fetch a web page and output its content using Playwright."""

import argparse
import asyncio
import sys

async def fetch_page(url, fmt="text", wait=3, screenshot=None, selector=None):
    from playwright.async_api import async_playwright

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context(
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        )
        page = await context.new_page()

        try:
            await page.goto(url, wait_until="networkidle", timeout=30000)
        except Exception:
            await page.goto(url, wait_until="domcontentloaded", timeout=30000)

        if wait > 0:
            await page.wait_for_timeout(wait * 1000)

        if screenshot:
            await page.screenshot(path=screenshot, full_page=True)
            print(f"[Screenshot saved to {screenshot}]", file=sys.stderr)

        if selector:
            el = await page.query_selector(selector)
            if el:
                if fmt == "html":
                    output = await el.inner_html()
                else:
                    output = await el.inner_text()
            else:
                print(f"[Selector '{selector}' not found]", file=sys.stderr)
                output = ""
        else:
            if fmt == "html":
                output = await page.content()
            elif fmt == "markdown":
                try:
                    from markdownify import markdownify
                    html = await page.content()
                    output = markdownify(html)
                except ImportError:
                    # Fallback: use inner_text with basic structure
                    output = await page.inner_text("body")
            else:
                output = await page.inner_text("body")

        await browser.close()
        return output


def main():
    parser = argparse.ArgumentParser(description="Fetch a web page using Playwright")
    parser.add_argument("url", help="URL to fetch")
    parser.add_argument("--format", choices=["text", "html", "markdown"], default="text", help="Output format (default: text)")
    parser.add_argument("--wait", type=float, default=3, help="Extra wait time in seconds (default: 3)")
    parser.add_argument("--screenshot", help="Save a screenshot to this path")
    parser.add_argument("--selector", help="CSS selector to extract specific content")
    args = parser.parse_args()

    result = asyncio.run(fetch_page(args.url, args.format, args.wait, args.screenshot, args.selector))
    print(result)


if __name__ == "__main__":
    main()
