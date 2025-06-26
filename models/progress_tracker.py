import time
from typing import Dict, Optional
from enum import Enum
import threading

class ProcessingStage(Enum):
    UPLOADING = "uploading"
    EXTRACTING_TEXT = "extracting_text"
    CHUNKING_TEXT = "chunking_text"
    GENERATING_EMBEDDINGS = "generating_embeddings"
    STORING_VECTORS = "storing_vectors"
    COMPLETED = "completed"
    FAILED = "failed"

class ProgressTracker:
    def __init__(self):
        self._progress_data: Dict[str, Dict] = {}
        self._lock = threading.Lock()
    
    def start_processing(self, file_id: str, filename: str, total_pages: int):
        """Initialize progress tracking for a file"""
        with self._lock:
            self._progress_data[file_id] = {
                "filename": filename,
                "total_pages": total_pages,
                "stage": ProcessingStage.UPLOADING.value,
                "progress_percent": 5,
                "message": "File uploaded successfully",
                "start_time": time.time(),
                "current_stage_start": time.time(),
                "error": None,
                "estimated_total_time": 60,  # seconds
                "stages_completed": 0,
                "total_stages": 6
            }
    
    def update_stage(self, file_id: str, stage: ProcessingStage, message: str, 
                    progress_percent: Optional[int] = None, extra_data: Dict = None):
        """Update the processing stage for a file"""
        with self._lock:
            if file_id not in self._progress_data:
                return False
            
            data = self._progress_data[file_id]
            data["stage"] = stage.value
            data["message"] = message
            data["current_stage_start"] = time.time()
            
            if progress_percent is not None:
                data["progress_percent"] = progress_percent
            else:
                # Auto-calculate progress based on stage
                stage_progress = {
                    ProcessingStage.UPLOADING: 10,
                    ProcessingStage.EXTRACTING_TEXT: 25,
                    ProcessingStage.CHUNKING_TEXT: 35,
                    ProcessingStage.GENERATING_EMBEDDINGS: 75,
                    ProcessingStage.STORING_VECTORS: 90,
                    ProcessingStage.COMPLETED: 100,
                    ProcessingStage.FAILED: data["progress_percent"]  # Keep current
                }
                data["progress_percent"] = stage_progress.get(stage, data["progress_percent"])
            
            if extra_data:
                data.update(extra_data)
            
            # Update stages completed
            if stage != ProcessingStage.FAILED:
                stage_order = [
                    ProcessingStage.UPLOADING,
                    ProcessingStage.EXTRACTING_TEXT,
                    ProcessingStage.CHUNKING_TEXT,
                    ProcessingStage.GENERATING_EMBEDDINGS,
                    ProcessingStage.STORING_VECTORS,
                    ProcessingStage.COMPLETED
                ]
                try:
                    data["stages_completed"] = stage_order.index(stage) + 1
                except ValueError:
                    pass
            
            return True
    
    def update_embedding_progress(self, file_id: str, current_chunk: int, total_chunks: int):
        """Update progress within the embedding generation stage"""
        with self._lock:
            if file_id not in self._progress_data:
                return False
            
            data = self._progress_data[file_id]
            if data["stage"] == ProcessingStage.GENERATING_EMBEDDINGS.value:
                # Embedding stage is 35% to 75% of total progress
                embedding_progress = (current_chunk / total_chunks) * 40  # 40% range for embeddings
                total_progress = 35 + embedding_progress  # Start from 35%
                
                data["progress_percent"] = min(int(total_progress), 75)
                data["message"] = f"Generating embeddings... ({current_chunk}/{total_chunks} chunks)"
                data["embedding_current"] = current_chunk
                data["embedding_total"] = total_chunks
            
            return True
    
    def set_error(self, file_id: str, error_message: str):
        """Mark processing as failed"""
        with self._lock:
            if file_id in self._progress_data:
                self._progress_data[file_id]["stage"] = ProcessingStage.FAILED.value
                self._progress_data[file_id]["error"] = error_message
                self._progress_data[file_id]["message"] = f"Error: {error_message}"
    
    def get_progress(self, file_id: str) -> Optional[Dict]:
        """Get current progress for a file"""
        with self._lock:
            data = self._progress_data.get(file_id)
            if data:
                # Calculate elapsed time and estimated remaining
                elapsed = time.time() - data["start_time"]
                if data["progress_percent"] > 0:
                    estimated_total = (elapsed / data["progress_percent"]) * 100
                    estimated_remaining = max(0, estimated_total - elapsed)
                else:
                    estimated_remaining = data["estimated_total_time"]
                
                return {
                    **data,
                    "elapsed_time": elapsed,
                    "estimated_remaining": estimated_remaining
                }
            return None
    
    def cleanup_completed(self, file_id: str, delay_seconds: int = 300):
        """Remove progress data for completed files after delay"""
        def cleanup():
            time.sleep(delay_seconds)
            with self._lock:
                if file_id in self._progress_data:
                    data = self._progress_data[file_id]
                    if data["stage"] in [ProcessingStage.COMPLETED.value, ProcessingStage.FAILED.value]:
                        del self._progress_data[file_id]
        
        thread = threading.Thread(target=cleanup, daemon=True)
        thread.start()

# Global progress tracker instance
progress_tracker = ProgressTracker()