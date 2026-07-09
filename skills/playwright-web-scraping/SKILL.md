---
name: playwright-web-scraping
description: >
  Use Playwright (Python) for all web scraping and page-fetching tasks instead of curl, wget, or requests.
  Trigger this skill whenever the task involves: fetching a web page's content, scraping data from a URL,
  reading a website's text, extracting information from HTML, or any task where a web page needs to be loaded
  and parsed. Playwright handles JavaScript-rendered pages, cookies, redirects, and anti-bot measures far
  better than curl. Do NOT use curl for fetching web page content — reserve curl exclusively for testing
  HTTP APIs (REST/GraphQL endpoints, checking status codes, headers, JSON responses).
---

# Playwright Web Scraping

## When to Use

- Fetching or scraping content from any web URL
- Reading article text, product info, search results, or any page data
- Extracting structured data from HTML pages
- Pages that require JavaScript rendering

## When NOT to Use

- Testing REST/GraphQL APIs (use `curl` directly)
- Checking HTTP status codes or response headers of API endpoints (use `curl`)
- Downloading binary files (use `wget` or `curl -O`)

## Quick Start

Run the bundled script to fetch page content as clean text:

```bash
python scripts/fetch_page.py <URL>
```

Options:
- `--format text` (default): output clean readable text
- `--format html`: output raw HTML
- `--format markdown`: output as Markdown
- `--wait <seconds>`: extra wait time for dynamic content (default: 3)
- `--screenshot <path>`: save a screenshot before extracting content
- `--selector <css>`: extract only content matching the CSS selector

## Writing Custom Playwright Code

When the bundled script is insufficient, write inline Python with Playwright:

```python
import asyncio
from playwright.async_api import async_playwright

async def scrape(url):
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page()
        await page.goto(url, wait_until="networkidle")
        # Extract what you need
        content = await page.content()          # full HTML
        text = await page.inner_text("body")    # visible text
        title = await page.title()
        await browser.close()
        return {"title": title, "text": text}

result = asyncio.run(scrape("https://example.com"))
print(result["text"][:2000])
```

## Key Patterns

### Wait for specific element
```python
await page.wait_for_selector("div.content", timeout=15000)
```

### Handle infinite scroll
```python
for _ in range(5):
    await page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
    await page.wait_for_timeout(2000)
```

### Fill forms and click
```python
await page.fill("input[name='q']", "search term")
await page.click("button[type='submit']")
await page.wait_for_load_state("networkidle")
```

### Extract multiple elements
```python
items = await page.query_selector_all("div.item")
for item in items:
    name = await item.inner_text()
    print(name)
```

## Environment Setup

Playwright runs in the omagents Python venv (see agents-python-tools skill for setup and cross-platform paths):

```bash
pip install playwright 2>/dev/null
python -m playwright install chromium 2>/dev/null
```

If Playwright and chromium are already installed, skip the install steps. Always check first with:
```bash
python -c "from playwright.async_api import async_playwright" 2>/dev/null && echo "OK" || echo "NEED_INSTALL"
```
