#!/usr/bin/env python3
"""DeepSeek 地理信息提取 — JSON 结构化输出

运行方式：
  export DEEPSEEK_API_KEY="sk-xxx"
  python3 geo_extract.py
"""

import os, json
from openai import OpenAI

client = OpenAI(
    api_key=os.environ.get("DEEPSEEK_API_KEY"),
    base_url="https://api.deepseek.com/v1",
)

GEO_PROMPT = """你是一个地理提取助手。从用户输入的文本中提取地理信息，始终以 JSON 格式输出。

输出格式：
{
  "locations": [
    {
      "name": "地点名称",
      "type": "国家/城市/地标/区域/河流/山脉",
      "country": "所属国家",
      "coordinates": {"lat": 纬度, "lng": 经度},
      "mentions": 提及次数
    }
  ],
  "relationships": [
    {"from": "A", "to": "B", "relation": "北方/南方/包含/相邻/距离xxx公里"}
  ],
  "summary": "一句话概括文本涉及的地理范围"
}

如果文本中没有地理信息，返回 locations 为空数组。"""

SAMPLE_TEXT = """
张先生从北京出发，乘坐高铁沿京沪线南下，途中经过天津和济南，最终抵达上海虹桥站。
他对上海的现代化天际线和外滩的历史建筑印象深刻。回程时他特意绕道南京参观了中山陵，
然后去了苏州园林。他感叹于长江流域城市的繁荣，以及黄河文明的深厚底蕴。
"""

response = client.chat.completions.create(
    model="deepseek-chat",  # 使用 deepseek-chat，非推理模型，无需思考模式
    messages=[
        {"role": "system", "content": GEO_PROMPT},
        {"role": "user", "content": SAMPLE_TEXT},
    ],
    temperature=0,                          # 结构化输出 → 零温度保证一致性
    max_tokens=800,
    response_format={"type": "json_object"}, # 强制 JSON 输出
)

result = json.loads(response.choices[0].message.content)
print(json.dumps(result, ensure_ascii=False, indent=2))
print(f"\n📊 Token 用量: {response.usage.total_tokens} "
      f"(输入: {response.usage.prompt_tokens}, 输出: {response.usage.completion_tokens})")
