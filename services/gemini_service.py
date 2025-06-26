import google.generativeai as genai
from config import Config
from typing import List, Dict, Any
import logging
import base64
from PIL import Image
import io

class GeminiService:
    def __init__(self):
        self.genai = Config.initialize_gemini()
        self.model = genai.GenerativeModel(Config.GEMINI_MODEL)
        self.embedding_model = Config.EMBEDDING_MODEL
        
    async def generate_text(self, prompt: str, context: str = "") -> str:
        """Generate text response using Gemini"""
        try:
            full_prompt = f"{context}\n\nUser Question: {prompt}" if context else prompt
            response = self.model.generate_content(full_prompt)
            return response.text
        except Exception as e:
            logging.error(f"Error generating text: {e}")
            raise
    
    async def generate_embeddings(self, texts: List[str]) -> List[List[float]]:
        """Generate embeddings for text chunks with batching"""
        try:
            embeddings = []
            batch_size = 5  # Process 5 chunks at once to reduce API calls
            
            for i in range(0, len(texts), batch_size):
                batch = texts[i:i + batch_size]
                batch_embeddings = []
                
                for text in batch:
                    result = genai.embed_content(
                        model=self.embedding_model,
                        content=text,
                        task_type="retrieval_document"
                    )
                    batch_embeddings.append(result['embedding'])
                
                embeddings.extend(batch_embeddings)
                
                # Small delay between batches to prevent rate limiting
                if i + batch_size < len(texts):
                    import asyncio
                    await asyncio.sleep(0.1)
                    
            return embeddings
        except Exception as e:
            logging.error(f"Error generating embeddings: {e}")
            raise
    
    async def generate_query_embedding(self, query: str) -> List[float]:
        """Generate embedding for search query"""
        try:
            result = genai.embed_content(
                model=self.embedding_model,
                content=query,
                task_type="retrieval_query"
            )
            return result['embedding']
        except Exception as e:
            logging.error(f"Error generating query embedding: {e}")
            raise
    
    async def generate_text_with_image(self, prompt: str, image_data: str, context: str = "") -> str:
        """Generate text response using Gemini with image input"""
        try:
            # Remove data URL prefix if present
            if image_data.startswith('data:image/'):
                image_data = image_data.split(',')[1]
            
            # Decode base64 image
            image_bytes = base64.b64decode(image_data)
            image = Image.open(io.BytesIO(image_bytes))
            
            # Create full prompt
            full_prompt = f"{context}\n\nUser Question: {prompt}" if context else prompt
            
            # Generate content with image
            response = self.model.generate_content([full_prompt, image])
            return response.text
            
        except Exception as e:
            logging.error(f"Error generating text with image: {e}")
            raise