#!/usr/bin/env python3
"""Convert documents to Markdown using MarkItDown."""

import argparse
import sys
from pathlib import Path


def convert_file(input_path: str, output_path: str = None, extension_hint: str = None) -> str:
    """Convert a file to Markdown.
    
    Args:
        input_path: Path to input file or URL
        output_path: Optional output file path
        extension_hint: File extension hint (e.g., '.pdf')
    
    Returns:
        Markdown content as string
    """
    from markitdown import MarkItDown
    
    md = MarkItDown()
    
    # Check if input is a URL
    if input_path.startswith(('http://', 'https://')):
        result = md.convert(input_path)
    else:
        # Local file
        input_file = Path(input_path)
        if not input_file.exists():
            raise FileNotFoundError(f"File not found: {input_path}")
        
        # Use extension hint if provided
        if extension_hint:
            result = md.convert_local(str(input_file), file_extension=extension_hint)
        else:
            result = md.convert_local(str(input_file))
    
    return result.text_content


def main():
    parser = argparse.ArgumentParser(
        description="Convert documents to Markdown using MarkItDown"
    )
    parser.add_argument(
        "input",
        help="Input file path or URL"
    )
    parser.add_argument(
        "-o", "--output",
        help="Output file path (default: stdout)"
    )
    parser.add_argument(
        "-x", "--extension",
        help="File extension hint (e.g., '.pdf')"
    )
    
    args = parser.parse_args()
    
    try:
        content = convert_file(args.input, args.output, args.extension)
        
        if args.output:
            output_path = Path(args.output)
            output_path.parent.mkdir(parents=True, exist_ok=True)
            output_path.write_text(content, encoding='utf-8')
            print(f"✓ Converted to {args.output}", file=sys.stderr)
        else:
            print(content)
    
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
