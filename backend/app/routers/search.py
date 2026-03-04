from fastapi import APIRouter, Depends

from app.core.async_vectordb import AsyncVectorStore
from app.dependencies import (
    get_embedder,
    get_project,
    get_query_llm,
    get_reranker,
    get_settings,
    get_vectordb,
)
from app.config import Settings
from app.llm.base import LLMProvider
from app.schemas.search import SearchRequest, SearchResponse
from app.services import search_service
from app.services.ingestion.embedder import Embedder
from app.services.reranker import Reranker

router = APIRouter()


@router.post("/search", response_model=SearchResponse)
async def global_search(
    data: SearchRequest,
    vectordb: AsyncVectorStore = Depends(get_vectordb),
    embedder: Embedder = Depends(get_embedder),
    reranker: Reranker | None = Depends(get_reranker),
    settings: Settings = Depends(get_settings),
    query_llm: LLMProvider | None = Depends(get_query_llm),
):
    results, plan = await search_service.search(
        vectordb=vectordb,
        embedder=embedder,
        query=data.query,
        top_k=data.top_k,
        mode=data.mode,
        reranker=reranker,
        candidate_k=settings.retrieval_candidate_k,
        query_llm=query_llm,
    )
    return SearchResponse(
        results=results,
        query_plan=plan.to_dict() if plan else None,
    )


@router.post("/projects/{project_id}/search", response_model=SearchResponse)
async def project_search(
    data: SearchRequest,
    project=Depends(get_project),
    vectordb: AsyncVectorStore = Depends(get_vectordb),
    embedder: Embedder = Depends(get_embedder),
    reranker: Reranker | None = Depends(get_reranker),
    settings: Settings = Depends(get_settings),
    query_llm: LLMProvider | None = Depends(get_query_llm),
):
    results, plan = await search_service.search(
        vectordb=vectordb,
        embedder=embedder,
        query=data.query,
        top_k=data.top_k,
        project_id=project.id,
        mode=data.mode,
        reranker=reranker,
        candidate_k=settings.retrieval_candidate_k,
        query_llm=query_llm,
    )
    return SearchResponse(
        results=results,
        query_plan=plan.to_dict() if plan else None,
    )
