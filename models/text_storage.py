import sqlite3
import os
from typing import List, Optional
from config import Config

class TextStorage:
    """Simple text storage for fast search without embeddings"""
    
    def __init__(self):
        self.db_path = Config.SQLITE_DB_PATH
        self._initialize_text_storage()
    
    def _initialize_text_storage(self):
        """Initialize text storage table"""
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.cursor()
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS document_text (
                    id TEXT PRIMARY KEY,
                    file_id TEXT,
                    chunk_index INTEGER,
                    content TEXT,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (file_id) REFERENCES files (id)
                )
            ''')
            conn.commit()
    
    def store_text_chunks(self, file_id: str, chunks: List[str]):
        """Store text chunks for basic search"""
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.cursor()
            
            # Clear existing chunks for this file
            cursor.execute("DELETE FROM document_text WHERE file_id = ?", (file_id,))
            
            # Insert new chunks
            for i, chunk in enumerate(chunks):
                chunk_id = f"{file_id}_chunk_{i}"
                cursor.execute(
                    "INSERT INTO document_text (id, file_id, chunk_index, content) VALUES (?, ?, ?, ?)",
                    (chunk_id, file_id, i, chunk)
                )
            
            conn.commit()
    
    def search_text(self, file_id: str, query: str, limit: int = 3) -> List[str]:
        """Basic text search using SQL LIKE"""
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.cursor()
            
            # Split query into keywords
            keywords = query.lower().split()
            
            # Build search query
            conditions = []
            params = [file_id]
            
            for keyword in keywords:
                conditions.append("LOWER(content) LIKE ?")
                params.append(f"%{keyword}%")
            
            if conditions:
                where_clause = f"file_id = ? AND ({' OR '.join(conditions)})"
            else:
                where_clause = "file_id = ?"
            
            cursor.execute(
                f"SELECT content FROM document_text WHERE {where_clause} ORDER BY chunk_index LIMIT ?",
                params + [limit]
            )
            
            results = cursor.fetchall()
            return [row[0] for row in results]
    
    def get_all_text(self, file_id: str) -> str:
        """Get all text for a file"""
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.cursor()
            cursor.execute(
                "SELECT content FROM document_text WHERE file_id = ? ORDER BY chunk_index",
                (file_id,)
            )
            
            results = cursor.fetchall()
            return "\n\n".join([row[0] for row in results])
    
    def delete_file_chunks(self, file_id: str) -> bool:
        """Delete all text chunks for a file"""
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.cursor()
            cursor.execute("DELETE FROM document_text WHERE file_id = ?", (file_id,))
            conn.commit()
            return cursor.rowcount > 0