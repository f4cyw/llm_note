import os
from dotenv import load_dotenv
import google.generativeai as genai

load_dotenv()

class Config:
    # Google Gemini API
    GOOGLE_API_KEY = os.getenv("GOOGLE_API_KEY")
    GEMINI_MODEL = "gemini-1.5-flash"  # Using 1.5-flash for cost efficiency in prototype
    EMBEDDING_MODEL = "models/text-embedding-004"
    
    # Database
    SQLITE_DB_PATH = "data/metadata.db"
    CHROMADB_PATH = "data/chromadb"
    
    # File uploads
    UPLOAD_DIR = "uploads"
    MAX_FILE_SIZE = 50 * 1024 * 1024  # 50MB
    
    # Text processing
    CHUNK_SIZE = 2000  # Larger chunks = fewer API calls
    CHUNK_OVERLAP = 300
    
    @classmethod
    def initialize_gemini(cls):
        """Initialize Gemini API with API key"""
        if not cls.GOOGLE_API_KEY:
            raise ValueError("GOOGLE_API_KEY not found in environment variables")
        genai.configure(api_key=cls.GOOGLE_API_KEY)
        return genai