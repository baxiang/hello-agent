from langchain.messages import HumanMessage, SystemMessage
from langchain.text_splitter import RecursiveCharacterTextSplitter
from langchain_community.document_loaders import TextLoader
from langchain_community.vectorstores import Chroma
from langchain_openai import ChatOpenAI, OpenAIEmbeddings


def create_doc_qa(docs_path: str):
    loader = TextLoader(docs_path)
    documents = loader.load()

    splitter = RecursiveCharacterTextSplitter(chunk_size=500, chunk_overlap=50)
    chunks = splitter.split_documents(documents)

    embeddings = OpenAIEmbeddings(
        model="text-embedding-3-small",
        openai_api_base="https://api.moonshot.cn/v1",
        openai_api_key="${MOONSHOT_API_KEY}",
    )
    vectorstore = Chroma.from_documents(chunks, embeddings)
    retriever = vectorstore.as_retriever(search_kwargs={"k": 3})

    model = ChatOpenAI(
        model="moonshot-v1-8k",
        openai_api_base="https://api.moonshot.cn/v1",
        openai_api_key="${MOONSHOT_API_KEY}",
    )

    return retriever, model


def query_docs(question: str, retriever, model) -> str:
    relevant_docs = retriever.invoke(question)
    context = "\n".join([doc.page_content for doc in relevant_docs])

    messages = [
        SystemMessage("根据以下文档回答问题：\n" + context),
        HumanMessage(question),
    ]

    response = model.invoke(messages)
    return response.content


def main():
    docs_path = "docs/sample.txt"
    retriever, model = create_doc_qa(docs_path)

    print("=== 文档问答系统 ===")

    questions = [
        "什么是变量？",
        "如何定义函数？",
        "类是什么？",
    ]

    for q in questions:
        print(f"问题: {q}")
        answer = query_docs(q, retriever, model)
        print(f"回答: {answer}\n")


if __name__ == "__main__":
    main()
