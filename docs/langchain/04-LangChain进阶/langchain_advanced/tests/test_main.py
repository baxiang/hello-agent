from app.main import create_rag_pipeline, query_rag


def test_create_rag_pipeline():
    docs_path = "docs/python_basics.txt"
    retriever, model = create_rag_pipeline(docs_path)
    assert retriever is not None
    assert model is not None


def test_query_returns_answer():
    docs_path = "docs/python_basics.txt"
    retriever, model = create_rag_pipeline(docs_path)
    answer = query_rag("什么是列表？", retriever, model)
    assert len(answer) > 0
