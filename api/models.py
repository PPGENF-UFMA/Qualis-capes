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


class ScopusAuthorMetrics(BaseModel):
    h_index: int | None = None
    citations: int | None = None
    documents: int | None = None
    author_id: str | None = None
    profile_url: str | None = None
    source: str = "Scopus (Elsevier)"
    available: bool = True


class OpenAlexAuthorMetrics(BaseModel):
    h_index: int | None = None
    i10_index: int | None = None
    citations: int | None = None
    works_count: int | None = None
    openalex_id: str | None = None
    profile_url: str | None = None
    source: str = "OpenAlex"
    available: bool = True


class AuthorImpactMetrics(BaseModel):
    orcid: str
    h_index: int | None = None
    h_index_source: str | None = None
    citations: int | None = None
    scopus: ScopusAuthorMetrics | None = None
    openalex: OpenAlexAuthorMetrics | None = None
    updated_at: str | None = None


class OrcidAnalyzeResponse(BaseModel):
    orcid: str
    researcher_name: str
    impact_metrics: AuthorImpactMetrics | None = None
    year_from: int | None = None
    year_to: int | None = None
    works_found: int
    works_in_range: int
    works_classified: int
    works_review: int
    results: list[dict]
    count: int


class SaveAliasRequest(BaseModel):
    journal_name: str
    issn: str


class FeedbackRequest(BaseModel):
    query: str
    wrong_issn: str | None = None
    right_issn: str | None = None
