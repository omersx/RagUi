"""Docling document conversion (PDF, DOCX, HTML, PPTX, MD) with optional OCR."""
from __future__ import annotations

import asyncio
import tempfile
from dataclasses import dataclass
from pathlib import Path

from ..utils.logger import get_logger

log = get_logger(__name__)

_converter_cache: dict[bool, object] = {}


@dataclass
class ParsedDocument:
    raw_markdown: str
    document: object | None = None  # DoclingDocument, kept for HybridChunker


def _build_converter(ocr: bool):
    """Lazily build + cache a DocumentConverter per OCR mode."""
    if ocr in _converter_cache:
        return _converter_cache[ocr]

    from docling.datamodel.base_models import InputFormat
    from docling.document_converter import DocumentConverter, PdfFormatOption

    try:
        from docling.datamodel.pipeline_options import PdfPipelineOptions
    except ImportError:  # older docling layout
        from docling.datamodel.pipeline_options import PdfPipelineOptions  # type: ignore[no-redef]

    pipeline_options = PdfPipelineOptions()
    pipeline_options.do_ocr = ocr
    try:
        pipeline_options.do_table_structure = True
    except AttributeError:  # pragma: no cover - field name drift across versions
        pass

    converter = DocumentConverter(
        format_options={InputFormat.PDF: PdfFormatOption(pipeline_options=pipeline_options)}
    )
    _converter_cache[ocr] = converter
    return converter


def _convert_sync(path: Path, ocr: bool):
    converter = _build_converter(ocr)
    return converter.convert(str(path))


async def parse_document(data: bytes, filename: str, ocr_enabled: bool = False) -> ParsedDocument:
    """Convert raw file bytes into Docling markdown. Runs in a worker thread."""
    suffix = Path(filename).suffix.lower()
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        tmp.write(data)
        tmp_path = Path(tmp.name)

    log.info("parser.start", filename=filename, ocr=ocr_enabled)
    try:
        result = await asyncio.to_thread(_convert_sync, tmp_path, ocr_enabled)
        markdown = result.document.export_to_markdown()
        log.info("parser.done", filename=filename, chars=len(markdown))
        return ParsedDocument(raw_markdown=markdown, document=result.document)
    finally:
        try:
            tmp_path.unlink(missing_ok=True)
        except OSError:  # pragma: no cover
            pass
