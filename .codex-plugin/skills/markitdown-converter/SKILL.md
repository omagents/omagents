---
name: markitdown-converter
description: >
  Use Microsoft MarkItDown to convert documents and files to Markdown for text extraction and parsing.
  Trigger this skill whenever the task involves: reading/extracting text from PDF, DOCX, PPTX, XLSX, XLS,
  HTML, CSV, EPUB, IPYNB, images (with OCR/LLM), audio (with transcription), Outlook MSG, RSS/ATOM feeds,
  ZIP archives, plain text files, Wikipedia pages, YouTube videos, or Bing search results. MarkItDown is
  the preferred tool for document parsing — do NOT use pdfplumber, PyPDF, python-docx, openpyxl, or
  beautifulsoup4 directly for reading these file types. Only fall back to specialized libraries when
  MarkItDown fails or when the task requires features it does not support (e.g. writing/editing documents,
  form filling, or programmatic spreadsheet manipulation).
---

# MarkItDown Converter

Use MarkItDown to convert documents to Markdown for reading and text extraction.

## Supported Formats

| Category | Extensions |
|----------|-----------|
| Documents | `.pdf`, `.docx`, `.pptx` |
| Spreadsheets | `.xlsx`, `.xls`, `.csv` |
| Web | `.html`, `.htm`, Wikipedia pages, YouTube, Bing search |
| E-books | `.epub` |
| Notebooks | `.ipynb` |
| Images | `.jpg`, `.jpeg`, `.png` (requires LLM client) |
| Audio | `.wav`, `.mp3`, `.m4a`, `.mp4` (requires speech_recognition) |
| Archives | `.zip` (recursively converts contents) |
| Email | `.msg` (Outlook messages) |
| Feeds | `.rss`, `.atom`, XML feeds |
| Text | `.txt`, `.md`, `.json`, `.jsonl` |

## Quick Start — CLI

The simplest way: run markitdown directly on a file.

```bash
markitdown input.pdf
markitdown input.docx -o output.md
```

Stdin is also supported: `cat input.xlsx | markitdown -x .xlsx`

## Python API

For programmatic use or when processing multiple files:

```python
from markitdown import MarkItDown

md = MarkItDown()
result = md.convert("document.pdf")
print(result.text_content)
```

Convert from URL:

```python
result = md.convert("https://example.com/report.pdf")
print(result.text_content)
```

## When NOT to Use MarkItDown

- **Writing/creating** documents (use python-docx, openpyxl, or pandoc instead)
- **Editing** existing documents in-place
- **Form filling** in PDFs
- **Programmatic spreadsheet manipulation** (writing cells, formulas)
- **Scraping web pages** that need JavaScript rendering (use Playwright instead)

## Environment

MarkItDown runs in the omagents Python venv (see agents-python-tools skill for setup and cross-platform paths):

```bash
# Check installation
python -c "from markitdown import MarkItDown; print('OK')"

# Install if missing
pip install markitdown
```
