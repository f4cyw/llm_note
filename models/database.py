import sqlite3
import json
from typing import Dict, List, Any, Optional
from datetime import datetime
from config import Config
import os

class DatabaseManager:
    def __init__(self):
        self.db_path = Config.SQLITE_DB_PATH
        self._ensure_db_directory()
        self._initialize_database()
    
    def _ensure_db_directory(self):
        """Ensure database directory exists"""
        os.makedirs(os.path.dirname(self.db_path), exist_ok=True)
    
    def _initialize_database(self):
        """Initialize database tables"""
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.cursor()
            
            # Files table
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS files (
                    id TEXT PRIMARY KEY,
                    filename TEXT NOT NULL,
                    file_size INTEGER,
                    total_pages INTEGER,
                    upload_timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
                    status TEXT DEFAULT 'processing'
                )
            ''')
            
            # Problem/Solution areas table
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS document_areas (
                    id TEXT PRIMARY KEY,
                    file_id TEXT,
                    page_number INTEGER,
                    area_type TEXT,  -- 'problem' or 'solution'
                    coordinates TEXT,  -- JSON string of coordinates
                    content TEXT,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (file_id) REFERENCES files (id)
                )
            ''')
            
            # Chat sessions table
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS chat_sessions (
                    id TEXT PRIMARY KEY,
                    file_id TEXT,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (file_id) REFERENCES files (id)
                )
            ''')
            
            # Chat messages table
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS chat_messages (
                    id TEXT PRIMARY KEY,
                    session_id TEXT,
                    message_type TEXT,  -- 'user' or 'assistant'
                    content TEXT,
                    context_sources TEXT,  -- JSON string of source references
                    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (session_id) REFERENCES chat_sessions (id)
                )
            ''')
            
            conn.commit()
    
    def add_file(self, file_id: str, filename: str, file_size: int, total_pages: int) -> str:
        """Add file record"""
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.cursor()
            cursor.execute(
                "INSERT INTO files (id, filename, file_size, total_pages) VALUES (?, ?, ?, ?)",
                (file_id, filename, file_size, total_pages)
            )
            conn.commit()
            return file_id
    
    def update_file_status(self, file_id: str, status: str):
        """Update file processing status"""
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.cursor()
            cursor.execute(
                "UPDATE files SET status = ? WHERE id = ?",
                (status, file_id)
            )
            conn.commit()
    
    def add_document_area(self, area_id: str, file_id: str, page_number: int, 
                         area_type: str, coordinates: Dict, content: str) -> str:
        """Add problem/solution area"""
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.cursor()
            cursor.execute(
                """INSERT INTO document_areas 
                   (id, file_id, page_number, area_type, coordinates, content) 
                   VALUES (?, ?, ?, ?, ?, ?)""",
                (area_id, file_id, page_number, area_type, json.dumps(coordinates), content)
            )
            conn.commit()
            return area_id
    
    def get_file(self, file_id: str) -> Optional[Dict]:
        """Get file information"""
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT * FROM files WHERE id = ?", (file_id,))
            row = cursor.fetchone()
            
            if row:
                columns = [desc[0] for desc in cursor.description]
                return dict(zip(columns, row))
            return None
    
    def get_document_areas(self, file_id: str, area_type: Optional[str] = None) -> List[Dict]:
        """Get problem/solution areas for a file"""
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.cursor()
            
            if area_type:
                cursor.execute(
                    "SELECT * FROM document_areas WHERE file_id = ? AND area_type = ?",
                    (file_id, area_type)
                )
            else:
                cursor.execute(
                    "SELECT * FROM document_areas WHERE file_id = ?",
                    (file_id,)
                )
            
            rows = cursor.fetchall()
            columns = [desc[0] for desc in cursor.description]
            
            areas = []
            for row in rows:
                area = dict(zip(columns, row))
                area['coordinates'] = json.loads(area['coordinates'])
                areas.append(area)
            
            return areas
    
    def delete_file(self, file_id: str) -> bool:
        """Delete a file record and all associated data"""
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.cursor()
            
            # Delete associated document areas first
            cursor.execute("DELETE FROM document_areas WHERE file_id = ?", (file_id,))
            
            # Delete chat sessions that reference only this file
            # First, find sessions that contain this file
            cursor.execute("SELECT id, file_ids FROM chat_sessions_v2 WHERE file_ids LIKE ?", 
                          (f"%{file_id}%",))
            sessions_to_check = cursor.fetchall()
            
            sessions_to_delete = []
            for session_id, file_ids_str in sessions_to_check:
                try:
                    import ast
                    file_ids = ast.literal_eval(file_ids_str)
                    if isinstance(file_ids, list):
                        # Remove this file_id from the list
                        updated_file_ids = [fid for fid in file_ids if fid != file_id]
                        if not updated_file_ids:
                            # If no files left, delete the session
                            sessions_to_delete.append(session_id)
                        else:
                            # Update the session with remaining files
                            cursor.execute("UPDATE chat_sessions_v2 SET file_ids = ? WHERE id = ?",
                                         (str(updated_file_ids), session_id))
                    else:
                        # Single file session, delete it
                        if file_ids_str.strip("'\"") == file_id:
                            sessions_to_delete.append(session_id)
                except:
                    # Fallback: if file_ids_str matches file_id, delete the session
                    if file_ids_str.strip("'\"") == file_id:
                        sessions_to_delete.append(session_id)
            
            # Delete sessions and their messages
            for session_id in sessions_to_delete:
                cursor.execute("DELETE FROM chat_messages_v2 WHERE session_id = ?", (session_id,))
                cursor.execute("DELETE FROM chat_sessions_v2 WHERE id = ?", (session_id,))
            
            # Finally, delete the file record
            cursor.execute("DELETE FROM files WHERE id = ?", (file_id,))
            
            conn.commit()
            return cursor.rowcount > 0
    
    def create_chat_session(self, session_id: str, file_id: str) -> str:
        """Create new chat session"""
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.cursor()
            cursor.execute(
                "INSERT INTO chat_sessions (id, file_id) VALUES (?, ?)",
                (session_id, file_id)
            )
            conn.commit()
            return session_id
    
    def add_chat_message(self, message_id: str, session_id: str, message_type: str, 
                        content: str, context_sources: List[Dict] = None) -> str:
        """Add chat message"""
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.cursor()
            sources_json = json.dumps(context_sources) if context_sources else None
            cursor.execute(
                """INSERT INTO chat_messages 
                   (id, session_id, message_type, content, context_sources) 
                   VALUES (?, ?, ?, ?, ?)""",
                (message_id, session_id, message_type, content, sources_json)
            )
            conn.commit()
            return message_id