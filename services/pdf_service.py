import PyPDF2
from pdfminer.high_level import extract_text_to_fp
from pdfminer.layout import LAParams
import io
from typing import List, Dict, Any
import logging
from config import Config

class PDFService:
    def __init__(self):
        self.chunk_size = Config.CHUNK_SIZE
        self.chunk_overlap = Config.CHUNK_OVERLAP
    
    async def extract_text_from_pdf(self, pdf_content: bytes) -> Dict[str, Any]:
        """Extract text from PDF file"""
        try:
            # Use PyPDF2 for basic extraction
            pdf_reader = PyPDF2.PdfReader(io.BytesIO(pdf_content))
            
            pages = []
            for page_num, page in enumerate(pdf_reader.pages):
                text = page.extract_text()
                pages.append({
                    "page_number": page_num + 1,
                    "text": text,
                    "char_count": len(text)
                })
            
            total_text = "\n\n".join([page["text"] for page in pages])
            
            return {
                "total_pages": len(pdf_reader.pages),
                "pages": pages,
                "total_text": total_text,
                "total_chars": len(total_text)
            }
        except Exception as e:
            logging.error(f"Error extracting text from PDF: {e}")
            raise
    
    async def extract_text_from_coordinates(self, pdf_content: bytes, page_num: int, 
                                          x1: float, y1: float, x2: float, y2: float) -> str:
        """Extract text from specific coordinates on a page (for future area selection)"""
        # This is a placeholder for coordinate-based extraction
        # Implementation would use pdfminer.six for precise coordinate extraction
        try:
            pdf_reader = PyPDF2.PdfReader(io.BytesIO(pdf_content))
            if page_num > len(pdf_reader.pages):
                raise ValueError(f"Page {page_num} does not exist")
            
            page = pdf_reader.pages[page_num - 1]
            # For now, return full page text
            # TODO: Implement coordinate-based extraction
            return page.extract_text()
        except Exception as e:
            logging.error(f"Error extracting text from coordinates: {e}")
            raise
    
    def chunk_text(self, text: str) -> List[str]:
        """Split text into chunks for embedding"""
        chunks = []
        words = text.split()
        
        current_chunk = []
        current_length = 0
        
        for word in words:
            word_length = len(word) + 1  # +1 for space
            
            if current_length + word_length > self.chunk_size and current_chunk:
                # Create chunk with overlap
                chunk_text = " ".join(current_chunk)
                chunks.append(chunk_text)
                
                # Start new chunk with overlap
                overlap_words = current_chunk[-self.chunk_overlap:] if len(current_chunk) > self.chunk_overlap else current_chunk
                current_chunk = overlap_words + [word]
                current_length = sum(len(w) + 1 for w in current_chunk)
            else:
                current_chunk.append(word)
                current_length += word_length
        
        # Add final chunk
        if current_chunk:
            chunks.append(" ".join(current_chunk))
        
        return chunks