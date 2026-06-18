# 文件输入 - 处理图片、音频和文件上传的多模态输入

## 概述

`fileinput` 示例演示了如何通过 trpc-agent-go 向模型发送多模态输入，包括文本、图片、音频和文件。支持两种文件传输模式：`file_ids`（先上传再引用，推荐用于 Hunyuan/Gemini）和 `file data`（Base64 内联编码）。

## 核心概念

`model.Message` 提供了丰富的多模态内容构建方法：

- `AddImageFilePath(path, detail)` - 添加本地图片，`detail` 可选 "auto"/"low"/"high"
- `AddAudioFilePath(path)` - 添加本地音频文件
- `AddFilePath(path)` - 以 Base64 编码添加文件
- `AddFileID(fileID)` - 通过预上传的文件 ID 引用

文件上传和删除通过 `openaimodel.Model` 的方法完成：
- `UploadFile(ctx, path)` - 上传文件并返回 file_id
- `DeleteFile(ctx, fileID)` - 删除已上传的文件

## 代码解析

**构建多模态消息：**

```go
userMessage := model.NewUserMessage("What is the content of the file?")

if p.imagePath != "" {
    userMessage.AddImageFilePath(p.imagePath, "auto")
}
if p.audioPath != "" {
    userMessage.AddAudioFilePath(p.audioPath)
}
if p.filePath != "" {
    p.addFileContent(ctx, &userMessage)
}
```

**file_ids 模式的上传与清理：**

```go
func (p *fileProcessor) addFileWithID(ctx context.Context, userMessage *model.Message) error {
    fileID, err := p.modelInstance.UploadFile(ctx, p.filePath)
    if err != nil {
        return err
    }
    p.uploadedFileID = fileID
    userMessage.AddFileID(fileID)
    return nil
}

func (p *fileProcessor) cleanup(ctx context.Context) error {
    if p.uploadedFileID == "" {
        return nil
    }
    return p.modelInstance.DeleteFile(ctx, p.uploadedFileID)
}
```

## 运行方式

```bash
cd examples

export OPENAI_API_KEY="your-key"

# 分析文本文件
go run ./fileinput -model=gpt-4o -text="分析这段代码" -file=./fileinput/test.txt

# 分析图片
go run ./fileinput -model=gpt-4o -image=./path/to/image.png

# 使用 Base64 模式
go run ./fileinput -model=gpt-4o -file=./fileinput/test.txt -file-ids=false

# Hunyuan 变体
go run ./fileinput -model=hunyuan-turbo -variant=hunyuan -file=./data.pdf
```

## 总结

多模态输入是构建视觉问答、文档分析、语音交互等场景的基础。两种文件传输模式各有优势：`file_ids` 避免请求体过大、支持文件复用，`file data` 则无需额外的上传步骤。实际使用中应注意在处理完成后清理已上传的文件，避免存储资源泄漏。
