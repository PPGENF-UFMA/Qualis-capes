from pydantic import BaseModel


class ClassificationResult(BaseModel):
    estrato: str
    justification: str
    all_candidates: list[dict] = []


class ClassifyResponse(BaseModel):
    issn: str
    title: str
    area: str
    jcr: float | None = None
    citeScore: float | None = None
    indexers: list[str] = []
    metrics: dict = {}
    classification: ClassificationResult
    scieloUpdatedAt: str | None = None
    lilacsUpdatedAt: str | None = None
    latindexUpdatedAt: str | None = None


class BatchClassifyRequest(BaseModel):
    issns: list[str]


class DbSummaryItem(BaseModel):
    issn: str
    title: str
    area: str


class SearchResult(BaseModel):
    issn: str
    title: str
    area: str
    source: str
