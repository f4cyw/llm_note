import sqlite3
import uuid
from typing import List, Dict, Any, Optional
from datetime import datetime
from config import Config

class ChatSessionManager:
    """Manage chat sessions with conversation memory and multi-document support"""
    
    def __init__(self):
        self.db_path = Config.SQLITE_DB_PATH
        self._initialize_chat_tables()
    
    def _initialize_chat_tables(self):
        """Initialize chat-related tables"""
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.cursor()
            
            # Enhanced chat sessions table
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS chat_sessions_v2 (
                    id TEXT PRIMARY KEY,
                    name TEXT,
                    file_ids TEXT,  -- JSON array of file IDs
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    last_activity DATETIME DEFAULT CURRENT_TIMESTAMP
                )
            ''')
            
            # Enhanced chat messages table
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS chat_messages_v2 (
                    id TEXT PRIMARY KEY,
                    session_id TEXT,
                    role TEXT,  -- 'user' or 'assistant'
                    content TEXT,
                    context_sources TEXT,  -- JSON string of source references
                    document_mode TEXT,  -- 'basic', 'rag', 'multi-doc'
                    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (session_id) REFERENCES chat_sessions_v2 (id)
                )
            ''')
            
            conn.commit()
    
    def create_session(self, file_ids: List[str], session_name: Optional[str] = None) -> str:
        """Create a new chat session for one or more documents"""
        session_id = str(uuid.uuid4())
        
        if not session_name:
            if len(file_ids) == 1:
                session_name = f"Chat with document"
            else:
                session_name = f"Multi-doc chat ({len(file_ids)} documents)"
        
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.cursor()
            cursor.execute(
                """INSERT INTO chat_sessions_v2 (id, name, file_ids) 
                   VALUES (?, ?, ?)""",
                (session_id, session_name, str(file_ids))  # Store as string representation
            )
            conn.commit()
        
        return session_id
    
    def add_message(self, session_id: str, role: str, content: str, 
                   context_sources: List[Dict] = None, document_mode: str = "basic") -> str:
        """Add a message to the chat session"""
        message_id = str(uuid.uuid4())
        
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.cursor()
            
            # Update last activity
            cursor.execute(
                "UPDATE chat_sessions_v2 SET last_activity = CURRENT_TIMESTAMP WHERE id = ?",
                (session_id,)
            )
            
            # Add message
            sources_json = str(context_sources) if context_sources else None
            cursor.execute(
                """INSERT INTO chat_messages_v2 
                   (id, session_id, role, content, context_sources, document_mode) 
                   VALUES (?, ?, ?, ?, ?, ?)""",
                (message_id, session_id, role, content, sources_json, document_mode)
            )
            
            conn.commit()
        
        return message_id
    
    def get_conversation_history(self, session_id: str, limit: int = 10) -> List[Dict]:
        """Get recent conversation history for context"""
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.cursor()
            cursor.execute(
                """SELECT role, content, timestamp FROM chat_messages_v2 
                   WHERE session_id = ? 
                   ORDER BY timestamp DESC 
                   LIMIT ?""",
                (session_id, limit)
            )
            
            rows = cursor.fetchall()
            # Reverse to get chronological order
            return [
                {
                    "role": row[0],
                    "content": row[1],
                    "timestamp": row[2]
                }
                for row in reversed(rows)
            ]
    
    def get_session_file_ids(self, session_id: str) -> List[str]:
        """Get file IDs associated with a session"""
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.cursor()
            cursor.execute(
                "SELECT file_ids FROM chat_sessions_v2 WHERE id = ?",
                (session_id,)
            )
            
            row = cursor.fetchone()
            if row:
                # Parse the string representation back to list
                try:
                    import ast
                    return ast.literal_eval(row[0])
                except:
                    return [row[0]]  # Fallback for single file
            return []
    
    def get_session_info(self, session_id: str) -> Optional[Dict]:
        """Get session information"""
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.cursor()
            cursor.execute(
                "SELECT id, name, file_ids, created_at, last_activity FROM chat_sessions_v2 WHERE id = ?",
                (session_id,)
            )
            
            row = cursor.fetchone()
            if row:
                return {
                    "id": row[0],
                    "name": row[1],
                    "file_ids": row[2],
                    "created_at": row[3],
                    "last_activity": row[4]
                }
            return None
    
    def list_sessions(self, limit: int = 20) -> List[Dict]:
        """List recent chat sessions"""
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.cursor()
            cursor.execute(
                """SELECT id, name, file_ids, created_at, last_activity 
                   FROM chat_sessions_v2 
                   ORDER BY last_activity DESC 
                   LIMIT ?""",
                (limit,)
            )
            
            rows = cursor.fetchall()
            return [
                {
                    "id": row[0],
                    "name": row[1],
                    "file_ids": row[2],
                    "created_at": row[3],
                    "last_activity": row[4]
                }
                for row in rows
            ]
    
    def delete_session(self, session_id: str) -> bool:
        """Delete a chat session and all its messages"""
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.cursor()
            
            # Delete messages first (foreign key constraint)
            cursor.execute(
                "DELETE FROM chat_messages_v2 WHERE session_id = ?",
                (session_id,)
            )
            
            # Delete session
            cursor.execute(
                "DELETE FROM chat_sessions_v2 WHERE id = ?",
                (session_id,)
            )
            
            conn.commit()
            return cursor.rowcount > 0