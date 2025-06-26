import chromadb
from chromadb.config import Settings
from typing import List, Dict, Any, Optional
import uuid
import logging
from config import Config

class VectorService:
    def __init__(self):
        self.client = chromadb.PersistentClient(
            path=Config.CHROMADB_PATH,
            settings=Settings(anonymized_telemetry=False)
        )
        self.collection_name = "pdf_chunks"
        self.collection = self._get_or_create_collection()
    
    def _get_or_create_collection(self):
        """Get or create ChromaDB collection"""
        try:
            return self.client.get_collection(name=self.collection_name)
        except Exception:
            return self.client.create_collection(
                name=self.collection_name,
                metadata={"description": "PDF text chunks for RAG"}
            )
    
    async def add_documents(self, texts: List[str], embeddings: List[List[float]], 
                          metadata: List[Dict[str, Any]]) -> List[str]:
        """Add documents to vector database"""
        try:
            document_ids = [str(uuid.uuid4()) for _ in texts]
            
            self.collection.add(
                documents=texts,
                embeddings=embeddings,
                metadatas=metadata,
                ids=document_ids
            )
            
            logging.info(f"Added {len(texts)} documents to vector database")
            return document_ids
        except Exception as e:
            logging.error(f"Error adding documents to vector database: {e}")
            raise
    
    async def search_similar(self, query_embedding: List[float], 
                           n_results: int = 5) -> Dict[str, Any]:
        """Search for similar documents"""
        try:
            results = self.collection.query(
                query_embeddings=[query_embedding],
                n_results=n_results,
                include=["documents", "metadatas", "distances"]
            )
            
            return {
                "documents": results["documents"][0] if results["documents"] else [],
                "metadatas": results["metadatas"][0] if results["metadatas"] else [],
                "distances": results["distances"][0] if results["distances"] else []
            }
        except Exception as e:
            logging.error(f"Error searching vector database: {e}")
            raise
    
    async def search_by_metadata(self, where_clause: Dict[str, Any], 
                               n_results: int = 10) -> Dict[str, Any]:
        """Search documents by metadata filters"""
        try:
            results = self.collection.get(
                where=where_clause,
                limit=n_results,
                include=["documents", "metadatas"]
            )
            
            return {
                "documents": results["documents"],
                "metadatas": results["metadatas"]
            }
        except Exception as e:
            logging.error(f"Error searching by metadata: {e}")
            raise
    
    async def delete_document_chunks(self, file_id: str):
        """Delete all chunks for a specific document"""
        try:
            self.collection.delete(
                where={"file_id": file_id}
            )
            logging.info(f"Deleted chunks for file_id: {file_id}")
        except Exception as e:
            logging.error(f"Error deleting document chunks: {e}")
            raise

    async def delete_by_metadata(self, where_clause: Dict[str, Any]):
        """Delete documents by metadata filters"""
        try:
            self.collection.delete(where=where_clause)
            logging.info(f"Deleted documents matching: {where_clause}")
        except Exception as e:
            logging.error(f"Error deleting by metadata: {e}")
            raise