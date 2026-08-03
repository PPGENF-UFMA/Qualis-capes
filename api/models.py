from pydantic import BaseModel, Field


class ClassificationResult(BaseModel):
    estrato: str
    justification: str
    all_candidates: list[dict] = Field(default_factory=list)


class ClassifyResponse(BaseModel):
    issn: str
    title: str
    area: str
    jcr: float | None = None
    citeScore: float | None = None
    indexers: list[str] = Field(default_factory=list)
    metrics: dict = Field(default_factory=dict)
    classification: ClassificationResult
    data_status: str = "complete"
    warnings: list[dict] = Field(default_factory=list)
    scieloUpdatedAt: str | None = None
    lilacsUpdatedAt: str | None = None
    latindexUpdatedAt: str | None = None
    jcr_source: str | None = None
    citescore_source: str | None = None


class BatchClassifyRequest(BaseModel):
    issns: list[str]


class BatchSearchRequest(BaseModel):
    queries: list[str]


class DbSummaryItem(BaseModel):
    issn: str
    title: str
    area: str


class SearchResult(BaseModel):
    issn: str
    title: str
    area: str
    source: str


class MatchCandidate(BaseModel):
    issn: str
    title: str
    score: float


class MatchResult(BaseModel):
    issn: str | None
    confidence: str  # "high" | "review" | "none"
    score: float
    stage: str  # "alias" | "exact" | "issn-extracted" | "containment" | "jaccard" | "none"
    candidates: list[MatchCandidate] = Field(default_factory=list)


class MatchBatchRequest(BaseModel):
    queries: list[str]
    article_titles: list[str] | None = None


class MatchBatchResponse(BaseModel):
    results: list[MatchResult]
    count: int


class MatchLattesRequest(BaseModel):
    text: str
    researcher_name: str | None = None


class OrcidAnalyzeRequest(BaseModel):
    orcid: str
    year_from: int | None = None
    year_to: int | None = None
    include_unclassified: bool = True


class SaveAliasRequest(BaseModel):
    journal_name: str
    issn: str


class FeedbackRequest(BaseModel):
    query: str
    wrong_issn: str | None = None
    right_issn: str | None = None
