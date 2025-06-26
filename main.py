from fastapi import FastAPI, File, UploadFile, HTTPException, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, FileResponse, Response
from fastapi.staticfiles import StaticFiles
import os
import uvicorn
import uuid
import logging
import sqlite3
from dotenv import load_dotenv

from services.pdf_service import PDFService
from services.gemini_service import GeminiService
from services.vector_service import VectorService
from models.database import DatabaseManager
from models.progress_tracker import progress_tracker, ProcessingStage
from models.text_storage import TextStorage
from models.chat_session import ChatSessionManager
from config import Config

# Load environment variables
load_dotenv()

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="LLM Learning Assistant", version="1.0.0")

# CORS middleware for frontend integration
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Configure properly for production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount static files
app.mount("/static", StaticFiles(directory="static"), name="static")

# Initialize services
pdf_service = PDFService()
gemini_service = GeminiService()
vector_service = VectorService()
db = DatabaseManager()
text_storage = TextStorage()
chat_manager = ChatSessionManager()

# Create uploads directory for storing PDFs
UPLOADS_DIR = "uploads"
os.makedirs(UPLOADS_DIR, exist_ok=True)

@app.get("/")
async def root():
    """Serve the main UI"""
    return FileResponse("static/index.html")

@app.get("/health")
async def health_check():
    return {"status": "healthy"}

@app.get("/api")
async def api_root():
    return {"message": "LLM Learning Assistant API", "status": "running"}

@app.post("/upload-pdf-fast")
async def upload_pdf_fast(file: UploadFile = File(...)):
    """Fast PDF upload - extract text only, enable chat immediately"""
    file_id = None
    try:
        logger.info(f"Starting fast PDF upload: {file.filename}")
        
        # Validate file type
        if not file.filename.endswith('.pdf'):
            raise HTTPException(status_code=400, detail="Only PDF files are allowed")
        
        # Check file size
        content = await file.read()
        if len(content) > Config.MAX_FILE_SIZE:
            raise HTTPException(status_code=400, detail="File too large")
        
        # Generate file ID
        file_id = str(uuid.uuid4())
        
        # Extract text from PDF (fast)
        pdf_data = await pdf_service.extract_text_from_pdf(content)
        
        # Save file info to database
        db.add_file(
            file_id=file_id,
            filename=file.filename,
            file_size=len(content),
            total_pages=pdf_data["total_pages"]
        )
        
        # Store the original PDF file for viewing
        pdf_path = os.path.join(UPLOADS_DIR, f"{file_id}.pdf")
        with open(pdf_path, "wb") as f:
            f.write(content)
        
        # Store text chunks for basic search (no embeddings yet)
        chunks = pdf_service.chunk_text(pdf_data["total_text"])
        text_storage.store_text_chunks(file_id, chunks)
        
        # Mark as text-extracted (ready for basic chat)
        db.update_file_status(file_id, "text_extracted")
        
        logger.info(f"Fast processing complete: {file.filename}")
        
        return {
            "file_id": file_id,
            "filename": file.filename,
            "total_pages": pdf_data["total_pages"],
            "total_chunks": len(chunks),
            "status": "text_extracted",
            "message": "Ready for basic chat! Embeddings will be generated in background for enhanced search."
        }
        
    except Exception as e:
        logger.error(f"Fast upload error: {e}")
        raise HTTPException(status_code=500, detail=f"Upload failed: {str(e)}")

@app.post("/upload-pdf")
async def upload_pdf(file: UploadFile = File(...)):
    """Full PDF upload with embeddings - for users who want to wait for complete processing"""
    file_id = None
    try:
        logger.info(f"Starting PDF upload: {file.filename}")
        
        # Validate file type
        if not file.filename.endswith('.pdf'):
            raise HTTPException(status_code=400, detail="Only PDF files are allowed")
        
        # Check file size
        content = await file.read()
        if len(content) > Config.MAX_FILE_SIZE:
            raise HTTPException(status_code=400, detail="File too large")
        
        # Generate file ID and start progress tracking
        file_id = str(uuid.uuid4())
        logger.info(f"Generated file ID: {file_id}")
        
        # Initialize progress tracking
        progress_tracker.start_processing(file_id, file.filename, 0)  # We'll update pages count later
        
        # Stage 1: Extract text from PDF
        progress_tracker.update_stage(file_id, ProcessingStage.EXTRACTING_TEXT, 
                                    "Extracting text from PDF...")
        logger.info("Extracting text from PDF...")
        pdf_data = await pdf_service.extract_text_from_pdf(content)
        logger.info(f"Extracted {pdf_data['total_pages']} pages, {pdf_data['total_chars']} characters")
        
        # Update progress with page count
        progress_tracker.update_stage(file_id, ProcessingStage.EXTRACTING_TEXT, 
                                    f"Extracted {pdf_data['total_pages']} pages successfully", 
                                    extra_data={"total_pages": pdf_data["total_pages"]})
        
        # Store the original PDF file for viewing
        pdf_path = os.path.join(UPLOADS_DIR, f"{file_id}.pdf")
        with open(pdf_path, "wb") as f:
            f.write(content)
        
        # Save file info to database
        db.add_file(
            file_id=file_id,
            filename=file.filename,
            file_size=len(content),
            total_pages=pdf_data["total_pages"]
        )
        logger.info("Saved file info to database")
        
        # Stage 2: Chunk text for embedding
        progress_tracker.update_stage(file_id, ProcessingStage.CHUNKING_TEXT, 
                                    "Breaking text into chunks...")
        chunks = pdf_service.chunk_text(pdf_data["total_text"])
        logger.info(f"Created {len(chunks)} text chunks")
        progress_tracker.update_stage(file_id, ProcessingStage.CHUNKING_TEXT, 
                                    f"Created {len(chunks)} text chunks", 
                                    extra_data={"total_chunks": len(chunks)})
        
        # Stage 3: Generate embeddings (this is the slow part!)
        try:
            progress_tracker.update_stage(file_id, ProcessingStage.GENERATING_EMBEDDINGS, 
                                        f"Generating embeddings for {len(chunks)} chunks...")
            logger.info("Generating embeddings...")
            
            # Generate embeddings with batched progress tracking
            embeddings = await gemini_service.generate_embeddings(chunks)
            
            # Update progress to show completion
            progress_tracker.update_embedding_progress(file_id, len(chunks), len(chunks))
            
            logger.info(f"Generated {len(embeddings)} embeddings")
            
            # Stage 4: Store in vector database
            progress_tracker.update_stage(file_id, ProcessingStage.STORING_VECTORS, 
                                        "Storing embeddings in vector database...")
            
            # Prepare metadata
            metadata = [
                {
                    "file_id": file_id,
                    "filename": file.filename,
                    "chunk_index": i,
                    "chunk_type": "general_text"
                }
                for i in range(len(chunks))
            ]
            
            # Store in vector database
            logger.info("Storing in vector database...")
            chunk_ids = await vector_service.add_documents(chunks, embeddings, metadata)
            logger.info(f"Stored {len(chunk_ids)} chunks in vector database")
            
        except Exception as embed_error:
            logger.error(f"Embedding error (API key issue?): {embed_error}")
            progress_tracker.set_error(file_id, f"Embedding failed: {str(embed_error)}")
            # Continue without embeddings for now - just store the file
            db.update_file_status(file_id, "text_extracted")
            return {
                "file_id": file_id,
                "filename": file.filename,
                "total_pages": pdf_data["total_pages"],
                "total_chunks": len(chunks),
                "status": "text_extracted",
                "warning": "Embeddings failed - check API key. You can still view the document but chat won't work."
            }
        
        # Stage 5: Final completion
        progress_tracker.update_stage(file_id, ProcessingStage.COMPLETED, 
                                    f"Successfully processed {file.filename}!")
        db.update_file_status(file_id, "completed")
        
        logger.info(f"Successfully processed PDF: {file.filename}")
        
        # Schedule cleanup of progress data
        progress_tracker.cleanup_completed(file_id, delay_seconds=300)  # 5 minutes
        
        return {
            "file_id": file_id,
            "filename": file.filename,
            "total_pages": pdf_data["total_pages"],
            "total_chunks": len(chunks),
            "status": "completed"
        }
        
    except HTTPException as he:
        if file_id:
            progress_tracker.set_error(file_id, he.detail)
        logger.error(f"HTTP error processing PDF: {he.detail}")
        raise he
    except Exception as e:
        if file_id:
            progress_tracker.set_error(file_id, str(e))
        logger.error(f"Unexpected error processing PDF: {e}")
        raise HTTPException(status_code=500, detail=f"Processing failed: {str(e)}")

@app.get("/files")
async def list_files():
    """List all uploaded files"""
    try:
        with sqlite3.connect(db.db_path) as conn:
            cursor = conn.cursor()
            cursor.execute("""
                SELECT id, filename, file_size, total_pages, upload_timestamp, status 
                FROM files 
                ORDER BY upload_timestamp DESC
            """)
            rows = cursor.fetchall()
            
            files = []
            for row in rows:
                # Get chunk count from vector store
                try:
                    results = vector_store.collection.get(where={"file_id": row[0]})
                    total_chunks = len(results.get('ids', []))
                except:
                    total_chunks = 0
                
                files.append({
                    "file_id": row[0],
                    "filename": row[1], 
                    "file_size": row[2],
                    "total_pages": row[3],
                    "upload_timestamp": row[4],
                    "status": row[5],
                    "total_chunks": total_chunks
                })
            
            return {"files": files}
    except Exception as e:
        logger.error(f"Error listing files: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/files/{file_id}")
async def get_file_info(file_id: str):
    """Get file information"""
    try:
        file_info = db.get_file(file_id)
        if not file_info:
            raise HTTPException(status_code=404, detail="File not found")
        
        # Add chunk count
        try:
            results = vector_store.collection.get(where={"file_id": file_id})
            file_info["total_chunks"] = len(results.get('ids', []))
        except:
            file_info["total_chunks"] = 0
            
        return file_info
    except Exception as e:
        logger.error(f"Error getting file info: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/progress/{file_id}")
async def get_upload_progress(file_id: str):
    """Get real-time upload progress"""
    try:
        progress = progress_tracker.get_progress(file_id)
        if not progress:
            raise HTTPException(status_code=404, detail="Progress not found")
        return progress
    except Exception as e:
        logger.error(f"Error getting progress: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/sessions")
async def create_chat_session(request: dict):
    """Create a new chat session for one or more documents"""
    try:
        file_ids = request.get("file_ids", [])
        session_name = request.get("name")
        
        if not file_ids:
            raise HTTPException(status_code=400, detail="At least one file_id is required")
        
        # Verify all files exist
        for file_id in file_ids:
            file_info = db.get_file(file_id)
            if not file_info:
                raise HTTPException(status_code=404, detail=f"File {file_id} not found")
        
        session_id = chat_manager.create_session(file_ids, session_name)
        
        return {
            "session_id": session_id,
            "file_ids": file_ids,
            "message": f"Chat session created for {len(file_ids)} document(s)"
        }
        
    except Exception as e:
        logger.error(f"Error creating chat session: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/sessions")
async def list_chat_sessions():
    """List recent chat sessions"""
    try:
        sessions = chat_manager.list_sessions()
        return {"sessions": sessions}
    except Exception as e:
        logger.error(f"Error listing sessions: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/sessions/{session_id}/chat")
async def chat_with_session(session_id: str, query: dict):
    """Chat with documents in a session (supports multi-document context)"""
    try:
        user_question = query.get("message", "")
        user_image = query.get("image", None)  # Base64 encoded image
        if not user_question:
            raise HTTPException(status_code=400, detail="Message is required")
        
        # Debug logging
        if user_image:
            logger.info(f"Received image data: {len(user_image)} characters")
        else:
            logger.info("No image data received")
        
        # Get session info and file IDs
        session_info = chat_manager.get_session_info(session_id)
        if not session_info:
            raise HTTPException(status_code=404, detail="Session not found")
        
        file_ids = chat_manager.get_session_file_ids(session_id)
        if not file_ids:
            raise HTTPException(status_code=400, detail="No documents in session")
        
        # Get conversation history for context
        conversation_history = chat_manager.get_conversation_history(session_id, limit=6)
        
        # Build conversation context
        conversation_context = ""
        if conversation_history:
            conversation_context = "Previous conversation:\n"
            for msg in conversation_history[-4:]:  # Last 4 messages for context
                conversation_context += f"{msg['role'].capitalize()}: {msg['content']}\n"
            conversation_context += "\n"
        
        # Collect document context from all files with problem-solution priority
        all_relevant_chunks = []
        document_info = []
        problem_solution_chunks = []
        
        for file_id in file_ids:
            file_info = db.get_file(file_id)
            if file_info:
                document_info.append(f"Document: {file_info['filename']}")
                
                # First, check for problem/solution areas
                try:
                    problem_areas = db.get_document_areas(file_id, "problem")
                    solution_areas = db.get_document_areas(file_id, "solution")
                    
                    # Search problem-solution areas with embeddings for better matches
                    if file_info["status"] == "completed":
                        query_embedding = await gemini_service.generate_query_embedding(user_question)
                        
                        # Search specifically in problem/solution areas
                        area_search_results = await vector_service.search_by_metadata(
                            {"file_id": file_id, "chunk_type": {"$in": ["problem_area", "solution_area"]}}, 
                            n_results=3
                        )
                        
                        if area_search_results["documents"]:
                            for doc, metadata in zip(area_search_results["documents"], area_search_results["metadatas"]):
                                area_type = metadata.get("area_type", "unknown")
                                problem_solution_chunks.append(
                                    f"From {file_info['filename']} [{area_type.upper()} AREA]: {doc}"
                                )
                        
                        # Regular RAG search as fallback
                        search_results = await vector_service.search_similar(query_embedding, n_results=2)
                        if search_results["documents"]:
                            all_relevant_chunks.extend([
                                f"From {file_info['filename']}: {doc}" 
                                for doc in search_results["documents"]
                            ])
                            
                    else:
                        # Fallback: search problem/solution content directly
                        for area in problem_areas + solution_areas:
                            if area["content"] and user_question.lower() in area["content"].lower():
                                problem_solution_chunks.append(
                                    f"From {file_info['filename']} [{area['area_type'].upper()} AREA]: {area['content'][:500]}..."
                                )
                                
                except Exception as e:
                    logger.warning(f"Problem-solution search failed for {file_id}: {e}")
                
                # Fallback to general text search if needed
                if not problem_solution_chunks and not all_relevant_chunks:
                    try:
                        if file_info["status"] == "completed":
                            query_embedding = await gemini_service.generate_query_embedding(user_question)
                            search_results = await vector_service.search_similar(query_embedding, n_results=2)
                            if search_results["documents"]:
                                all_relevant_chunks.extend([
                                    f"From {file_info['filename']}: {doc}" 
                                    for doc in search_results["documents"]
                                ])
                        else:
                            relevant_chunks = text_storage.search_text(file_id, user_question, limit=2)
                            if relevant_chunks:
                                all_relevant_chunks.extend([
                                    f"From {file_info['filename']}: {chunk}" 
                                    for chunk in relevant_chunks
                                ])
                    except Exception as e:
                        logger.warning(f"Fallback search failed for {file_id}: {e}")
        
        # Prioritize problem-solution chunks
        all_chunks = problem_solution_chunks[:3] + all_relevant_chunks[:3]
        
        # Build comprehensive context with educational focus
        if all_chunks:
            # Determine if this is a problem-solving query
            is_problem_solving = any(word in user_question.lower() for word in 
                                   ["how", "solve", "solution", "answer", "explain", "why", "what"])
            
            educational_instruction = ""
            if problem_solution_chunks:
                educational_instruction = """
EDUCATIONAL CONTEXT: This document contains tagged problem and solution areas. Use this structured information to provide educational guidance.
- PROBLEM AREAS contain questions, exercises, or challenges
- SOLUTION AREAS contain answers, explanations, or methods
- When answering, reference both problems and solutions to provide comprehensive learning support"""

            document_context = f"""You are an educational AI assistant helping with {len(file_ids)} document(s): {', '.join([info.split(': ')[1] for info in document_info])}
{educational_instruction}

Relevant content from the documents:
{chr(10).join(all_chunks[:6])}  

{conversation_context}Current question: {user_question}

Please provide a helpful educational answer. If the question relates to a problem, try to guide the student through the solution process rather than just giving the answer."""
        else:
            document_context = f"""You are an educational AI assistant working with {len(file_ids)} document(s): {', '.join([info.split(': ')[1] for info in document_info])}

{conversation_context}Current question: {user_question}

Please provide a helpful educational answer. No specific relevant content was found in the documents for this question, but try to provide general guidance based on the document context."""

        # Generate response with full context - use vision model if image is provided
        if user_image:
            logger.info("Using Gemini vision model for image-based query")
            response = await gemini_service.generate_text_with_image(user_question, user_image, document_context)
        else:
            response = await gemini_service.generate_text(user_question, document_context)
        
        # Store conversation
        chat_manager.add_message(session_id, "user", user_question)
        chat_manager.add_message(session_id, "assistant", response, 
                               context_sources=all_chunks[:3],
                               document_mode="multi-doc" if len(file_ids) > 1 else "single-doc")
        
        # Enhanced response metadata
        response_mode = "educational"
        if problem_solution_chunks:
            response_mode = "problem-solution-guided"
        
        return {
            "question": user_question,
            "answer": response,
            "session_id": session_id,
            "documents_used": len(file_ids),
            "mode": "multi-doc" if len(file_ids) > 1 else "single-doc",
            "response_mode": response_mode,
            "problem_solution_areas_used": len(problem_solution_chunks),
            "sources": all_chunks[:3]
        }
        
    except Exception as e:
        logger.error(f"Error in session chat: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/chat/{file_id}")
async def chat_with_document(file_id: str, query: dict):
    """Legacy single-document chat - redirects to session-based chat"""
    try:
        # Check if file exists
        file_info = db.get_file(file_id)
        if not file_info:
            raise HTTPException(status_code=404, detail="File not found")
        
        # Create or find existing session for this file
        session_id = chat_manager.create_session([file_id], f"Chat with {file_info['filename']}")
        
        # Forward to session-based chat
        session_query = {"message": query.get("message", "")}
        return await chat_with_session(session_id, session_query)
        
    except Exception as e:
        logger.error(f"Error in legacy chat: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/files/{file_id}/pdf")
async def get_pdf_file(file_id: str):
    """Serve the original PDF file for viewing"""
    try:
        # Check if file exists in database
        file_info = db.get_file(file_id)
        if not file_info:
            raise HTTPException(status_code=404, detail="File not found")
        
        # Check if PDF file exists on disk
        pdf_path = os.path.join(UPLOADS_DIR, f"{file_id}.pdf")
        if not os.path.exists(pdf_path):
            raise HTTPException(status_code=404, detail="PDF file not found on disk")
        
        # Return the PDF file
        return FileResponse(
            pdf_path,
            media_type="application/pdf",
            filename=file_info["filename"]
        )
        
    except Exception as e:
        logger.error(f"Error serving PDF: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.delete("/sessions/{session_id}")
async def delete_chat_session(session_id: str):
    """Delete a chat session and its messages"""
    try:
        # Check if session exists
        session_info = chat_manager.get_session_info(session_id)
        if not session_info:
            raise HTTPException(status_code=404, detail="Session not found")
        
        # Delete session and its messages
        deleted = chat_manager.delete_session(session_id)
        if deleted:
            return {"message": "Session deleted successfully"}
        else:
            raise HTTPException(status_code=404, detail="Session not found")
            
    except Exception as e:
        logger.error(f"Error deleting session: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.delete("/files/{file_id}")
async def delete_pdf_file(file_id: str):
    """Delete a PDF file and all its associated data"""
    try:
        # Check if file exists
        file_info = db.get_file(file_id)
        if not file_info:
            raise HTTPException(status_code=404, detail="File not found")
        
        # Delete from database
        db.delete_file(file_id)
        
        # Delete text chunks
        text_storage.delete_file_chunks(file_id)
        
        # Delete from vector database
        try:
            await vector_service.delete_document_chunks(file_id)
        except Exception as e:
            logger.warning(f"Could not delete from vector DB: {e}")
        
        # Delete PDF file from disk
        pdf_path = os.path.join(UPLOADS_DIR, f"{file_id}.pdf")
        if os.path.exists(pdf_path):
            os.remove(pdf_path)
        
        return {"message": "File deleted successfully"}
        
    except Exception as e:
        logger.error(f"Error deleting file: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/translate")
async def translate_text(request: dict):
    """Translate text using Gemini model"""
    try:
        text_to_translate = request.get("text", "")
        target_language = request.get("target_language", "Korean") # Default to Korean

        if not text_to_translate:
            raise HTTPException(status_code=400, detail="Text to translate is required")

        prompt = f"Translate the following text into {target_language}:\n\n{text_to_translate}"
        translated_text = await gemini_service.generate_text(prompt)

        return {"original_text": text_to_translate, "translated_text": translated_text, "target_language": target_language}

    except Exception as e:
        logger.error(f"Error translating text: {e}")
        raise HTTPException(status_code=500, detail=f"Translation failed: {str(e)}")

@app.post("/files/{file_id}/areas")
async def add_document_area(file_id: str, request: dict):
    """Add a problem/solution area to a document"""
    try:
        area_type = request.get("area_type")  # 'problem' or 'solution'
        page_number = request.get("page_number")
        coordinates = request.get("coordinates")  # {x, y, width, height}
        content = request.get("content", "")

        if not area_type or area_type not in ['problem', 'solution']:
            raise HTTPException(status_code=400, detail="area_type must be 'problem' or 'solution'")
        
        if not page_number or not coordinates:
            raise HTTPException(status_code=400, detail="page_number and coordinates are required")

        # Verify file exists
        file_info = db.get_file(file_id)
        if not file_info:
            raise HTTPException(status_code=404, detail="File not found")

        # Generate area ID
        area_id = str(uuid.uuid4())
        
        # Store area in database
        db.add_document_area(area_id, file_id, page_number, area_type, coordinates, content)

        # Extract content from PDF area if not provided
        if not content:
            try:
                # Get PDF path
                pdf_path = os.path.join(UPLOADS_DIR, f"{file_id}.pdf")
                if os.path.exists(pdf_path):
                    with open(pdf_path, "rb") as f:
                        pdf_content = f.read()
                    
                    # Extract text from specific area
                    area_text = await pdf_service.extract_text_from_area(
                        pdf_content, page_number, coordinates
                    )
                    
                    # Update content in database
                    if area_text.strip():
                        content = area_text
                        # Update the area with extracted content
                        with sqlite3.connect(db.db_path) as conn:
                            cursor = conn.cursor()
                            cursor.execute(
                                "UPDATE document_areas SET content = ? WHERE id = ?",
                                (content, area_id)
                            )
                            conn.commit()
            except Exception as e:
                logger.warning(f"Could not extract content from area: {e}")

        # Store area-specific embedding for enhanced RAG
        if content.strip():
            try:
                # Generate specialized embedding for problem/solution context
                embedding = await gemini_service.generate_embeddings([content])
                
                # Store in vector database with specialized metadata
                metadata = [{
                    "file_id": file_id,
                    "area_id": area_id,
                    "area_type": area_type,
                    "page_number": page_number,
                    "chunk_type": f"{area_type}_area",
                    "coordinates": coordinates
                }]
                
                await vector_service.add_documents([content], embedding, metadata)
                
            except Exception as e:
                logger.warning(f"Could not create embedding for area: {e}")

        return {
            "area_id": area_id,
            "file_id": file_id,
            "area_type": area_type,
            "page_number": page_number,
            "coordinates": coordinates,
            "content": content,
            "message": f"Successfully added {area_type} area"
        }

    except Exception as e:
        logger.error(f"Error adding document area: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/files/{file_id}/areas")
async def get_document_areas(file_id: str, area_type: str = None):
    """Get problem/solution areas for a document"""
    try:
        # Verify file exists
        file_info = db.get_file(file_id)
        if not file_info:
            raise HTTPException(status_code=404, detail="File not found")

        areas = db.get_document_areas(file_id, area_type)
        
        return {
            "file_id": file_id,
            "areas": areas,
            "total_areas": len(areas)
        }

    except Exception as e:
        logger.error(f"Error getting document areas: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.delete("/files/{file_id}/areas/{area_id}")
async def delete_document_area(file_id: str, area_id: str):
    """Delete a problem/solution area"""
    try:
        # Verify file exists
        file_info = db.get_file(file_id)
        if not file_info:
            raise HTTPException(status_code=404, detail="File not found")

        # Delete from database
        with sqlite3.connect(db.db_path) as conn:
            cursor = conn.cursor()
            cursor.execute(
                "DELETE FROM document_areas WHERE id = ? AND file_id = ?",
                (area_id, file_id)
            )
            deleted = cursor.rowcount > 0
            conn.commit()

        if not deleted:
            raise HTTPException(status_code=404, detail="Area not found")

        # Delete from vector database
        try:
            await vector_service.delete_by_metadata({"area_id": area_id})
        except Exception as e:
            logger.warning(f"Could not delete area from vector DB: {e}")

        return {"message": "Area deleted successfully"}

    except Exception as e:
        logger.error(f"Error deleting document area: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/files/{file_id}/extract-area")
async def extract_area_text(file_id: str, request: dict):
    try:
        page_number = request.get("page_number", 1)
        coordinates = request.get("coordinates")
        
        if not coordinates:
            raise HTTPException(status_code=400, detail="Coordinates are required")
        
        # Get file from database
        db = Database()
        file_info = db.get_file(file_id)
        if not file_info:
            raise HTTPException(status_code=404, detail="File not found")
        
        # Extract text from the specified area
        pdf_service = PDFService()
        pdf_content = Path(file_info['file_path']).read_bytes()
        
        extracted_text = await pdf_service.extract_text_from_area(
            pdf_content, page_number, coordinates
        )
        
        return {
            "success": True,
            "text": extracted_text,
            "page_number": page_number,
            "coordinates": coordinates
        }
        
    except Exception as e:
        logger.error(f"Error extracting area text: {e}")
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)