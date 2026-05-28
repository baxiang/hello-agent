from app.main import create_doc_qa, query_docs


def test_create_doc_qa():
    retriever, model = create_doc_qa("docs/sample.txt")
    assert retriever is not None
    assert model is not None


def test_query_docs():
    retriever, model = create_doc_qa("docs/sample.txt")
    answer = query_docs("什么是变量？", retriever, model)
    assert len(answer) > 0
