# MindFlow AI 감정 일기 - API 연동 기술 설명서

젊은 시절 도스(DOS)용 BASIC, C, COBOL 언어를 공부하셨던 사용자님의 훌륭한 논리적 배경에 깊은 경의를 표합니다. 

이 설명서는 이번 프로젝트에서 가장 핵심이 되는 **Vercel 서버리스 백엔드 API 연동 코드**가 모던 자바스크립트(ES6+) 환경에서 어떻게 상호작용하는지, 구조적 프로그래밍 관점에서 직관적으로 해석한 가이드라인입니다.

---

## 1. 아키텍처 비유 (BASIC / C / COBOL과의 비교)

과거의 프로그램이 메모리와 로컬 파일(Sequential File, Random File)을 직접 제어했다면, 모던 웹 프로그램은 **네트워크상의 분산된 자원(REST API)**을 주고받으며 실행됩니다.

| 개념 | 과거 언어 (BASIC, C, COBOL) | 모던 웹 (Javascript, Node.js) | 비유 및 해석 |
| :--- | :--- | :--- | :--- |
| **비동기 처리** | 순차적 톱다운 실행 (GOTO, 함수 호출) | `async` / `await` | 비블로킹(Non-blocking) 호출. C의 쓰레드(Thread)나 인터럽트와 유사하게, 네트워크 응답이 올 때까지 프로그램이 멈추지 않고 대기했다가 깨어남. |
| **서버리스** | 상주형 메인 메모리 구동 | Vercel Serverless Function | 필요할 때만 임시 컨테이너(메모리)를 띄워 코드를 딱 한 번 실행(GOSUB)하고 메모리를 반환하는 효율적 아키텍처. |
| **인터페이스** | DATA DIVISION, 구조체(Struct) | JSON (Javascript Object Notation) | 구조체(`struct`)나 COBOL의 변수 그룹핑 레코드 형식을 문자열 포맷 하나로 통일한 범용 데이터 교환 양식. |
| **데이터베이스** | 로컬 파일 I/O, SQL DBMS | Upstash Serverless Redis (REST) | 메모리상에 `Key-Value` 쌍으로 데이터를 고속으로 저장/조회하는 원격 해시테이블. |

---

## 2. api/analyze.js - 감정 분석 및 Redis 백업 API

이 파일은 일기 본문(content)을 받아 **1단계: Gemini AI 분석**을 거쳐 **2단계: Redis DB 백업**을 순차 수행하는 백엔드 핵심 컨트롤러입니다.

```javascript
// api/analyze.js

/**
 * [REDIS_URL 파싱 도우미 함수]
 * C언어의 구조체(Struct) 리턴 방식처럼, 복잡한 문자열 주소에서 host와 password(token)를 추출합니다.
 */
function parseRedisUrl(redisUrl) {
  try {
    // 1. 값의 양끝에 큰따옴표(")나 작은따옴표(')가 섞여 있다면 제거 (EUC-KR/UTF-8 따옴표 정제)
    const cleanedKey = redisUrl.replace(/^['"]|['"]$/g, '').trim();
    // 2. 프로토콜 헤더(rediss://) 제거
    const cleanedUrl = cleanedKey.replace(/^rediss?:\/\//, '');
    // 3. '@' 기호 기준으로 인증 정보와 주소를 분리
    const [auth, hostPort] = cleanedUrl.split('@');
    // 4. username:password 분리 (기본 username은 default)
    const [username, password] = auth.split(':');
    // 5. host:port 분리
    const [host, port] = hostPort.split(':');
    
    // C의 구조체(struct)처럼 객체 형태로 반환
    return {
      restUrl: `https://${host}`,
      restToken: password
    };
  } catch (e) {
    console.error("Failed to parse REDIS_URL:", e);
    return null;
  }
}

/**
 * [로컬 감정 분석 폴백(Fallback) 엔진]
 * 구글 API 요금제 한도초과(429)나 인증키 문제(401) 시 구동되는 자가 로직입니다.
 * COBOL의 EVALUATE 문이나 C의 switch-case 패턴처럼 키워드 매칭 스코어를 계산합니다.
 */
function performLocalAnalysis(content) {
  // 감정 사전 정의
  const emotionDict = {
    joy: ['행복', '기쁨', '기뻐', '즐거', '신나', '최고', '감사', '좋았', '뿌듯', '웃었', '사랑', '다행', '설레', '웃음', '성공', '만족', '축하', '이겨내', '해냈다', '완벽', '행운'],
    sadness: ['슬프', '우울', '힘들', '눈물', '아프', '외롭', '상처', '속상', '지치', '후회', '그립', '괴롭', '한숨', '답답', '눈물만', '절망', '그리워', '버림받', '울었', '서럽', '낙담', '포기'],
    anger: ['화나', '짜증', '열받', '분하', '억울', '미워', '싫어', '화가', '폭발', '욱하', '싸웠', '다퉜', '지겨', '스트레스', '빡치', '밉다', '분노', '어이없', '망쳤'],
    anxiety: ['불안', '걱정', '두려', '무서', '초조', '떨려', '긴장', '어쩌지', '막막', '예민', '심장', '식은땀', '숨막', '무기력', '어둡', '겁나', '부담', '조급', '악몽'],
    fatigue: ['귀찮', '피곤', '무기력', '졸려', '지루', '멍하', '지쳤', '아무것도', '쉬고', '쉬고 싶', '자고 싶', '체력', '번아웃', '나른', '눕고', '멍때', '귀차니즘'],
    calm: ['평온', '차분', '안정', '편안', '휴식', '쉼', '여유', '그냥', '보통', '무난', '조용', '괜찮', '소소', '잔잔', '독서', '산책', '안도', '수면']
  };

  // 감정 스코어 초기화
  const scores = { joy: 0, sadness: 0, anger: 0, anxiety: 0, fatigue: 0, calm: 0 };
  
  // 키워드 검출 루프 (BASIC의 FOR-NEXT 루프와 대응)
  for (const [emotion, keywords] of Object.entries(emotionDict)) {
    for (const word of keywords) {
      if (content.includes(word)) {
        scores[emotion] += 1; // 단어 출현 빈도 가산
      }
    }
  }

  // 가장 높은 스코어 탐색
  let maxScore = -1;
  let primaryEmotion = 'calm';
  for (const [emotion, score] of Object.entries(scores)) {
    if (score > maxScore) {
      maxScore = score;
      primaryEmotion = emotion;
    }
  }
  
  if (maxScore === 0) primaryEmotion = 'calm'; // 매칭 단어 없으면 평온이 기본값

  const emotionLabels = {
    joy: '기쁨', sadness: '슬픔', anger: '화남/짜증',
    anxiety: '불안/걱정', fatigue: '무기력/피곤', calm: '평온'
  };

  // 따뜻한 힐링 피드백 라이브러리 (랜덤 응답 추출)
  const advicePool = {
    joy: [
      "오늘 하루가 긍정적이고 기쁜 에너지로 가득해서 참 다행입니다. 이 행복한 기억을 마음속 깊이 새겨보세요.",
      "기쁨은 나누면 배가 된다고 합니다. 오늘 느낀 행복감을 주변 사람들과 소소하게 공유해보시는 것도 좋겠어요.",
      "오늘같이 좋은 날은 스스로에게 작은 칭찬이나 선물을 해주는 것도 멋진 선택입니다. 내일도 오늘처럼 빛나길 바랍니다."
    ],
    sadness: [
      "마음의 슬픔과 비가 내리는 날이 있듯, 울고 싶을 때는 억지로 참지 않아도 괜찮습니다. 힘든 하루 고생 많으셨어요.",
      "어둠 속에서도 별은 빛나듯이, 오늘의 아픔은 당신을 한 걸음 더 단단하게 성장시킬 따뜻한 자양분이 될 거예요.",
      "슬프고 속상한 일은 털어버리고, 따뜻한 음료 한 잔과 함께 온전히 당신만을 위한 포근한 휴식 시간을 가져보세요."
    ],
    anger: [
      "화나고 짜증스러운 일 때문에 마음이 많이 무거우셨겠어요. 일기로 털어내신 것은 마음에 큰 위안이 될 것입니다.",
      "감정이 격해질 때는 눈을 잠시 감고 심호흡을 깊게 3번 해보세요. 한결 차분해진 마음의 평온을 느낄 수 있을 것입니다.",
      "화가 나는 상황에 얽매이기보다, 좋아하는 음악을 듣거나 가벼운 스트레칭으로 신체적 긴장을 먼저 풀어보세요."
    ],
    anxiety: [
      "마음속 불안감과 두려움으로 인해 오늘 하루 참 외롭고 힘든 시간을 견디셨겠어요. 일기로 감정을 적은 것만으로도 큰 시작입니다.",
      "아직 일어나지 않은 일에 대한 걱정은 잠시 내려두고, 오늘 밤은 당신의 호흡에만 집중해 보세요. 당신은 강한 사람입니다.",
      "불안할 때는 포근한 이불 속에서 몸을 따뜻하게 하고 깊은 수면을 취하는 것이 최고입니다. 괜찮을 거예요."
    ],
    fatigue: [
      "무기력하고 번아웃이 온 듯한 무거운 하루였군요. 지친 몸과 마음이 쉬어 가라는 조용한 신호를 보내는 것입니다.",
      "오늘은 계획이나 의무를 잠시 내려놓고, 온전히 아무것도 하지 않는 게으름을 누려보세요. 휴식은 낭비가 아닙니다.",
      "지친 당신에게 따뜻한 위로와 격려를 보냅니다. 오늘 하루 버텨낸 것만으로도 충분히 자랑스럽습니다. 푹 쉬세요."
    ],
    calm: [
      "차분하고 평온한 하루를 보내셨다니 참 좋습니다. 소소한 일상에서 잔잔한 여유를 느끼는 것이야말로 진정한 행복입니다.",
      "특별한 일이 없어도 물 흐르듯 평온하게 흐르는 하루는 마음의 에너지를 충전하는 소중한 쉼터가 됩니다.",
      "오늘의 잔잔한 평화가 당신의 내일에도 가득 깃들기를 진심으로 바라며, 기분 좋은 미소와 함께 밤을 맞이하세요."
    ]
  };

  const adviceList = advicePool[primaryEmotion];
  const selectedAdvice = adviceList[Math.floor(Math.random() * adviceList.length)];
  const adviceLabel = emotionLabels[primaryEmotion];
  
  return {
    emotionKey: primaryEmotion,
    geminiText: `감정: ${adviceLabel}\n\n${selectedAdvice}`
  };
}

/**
 * [메인 서버리스 API 핸들러]
 * HTTP POST 요청을 받아 분기 실행합니다.
 */
export default async function handler(request, response) {
  // CORS 정책 설정 (외부 도메인 차단 해제)
  response.setHeader('Access-Control-Allow-Credentials', true);
  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  response.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  // 브라우저의 사전 접속(Preflight) 요청에 대한 응답
  if (request.method === 'OPTIONS') {
    return response.status(200).end();
  }

  if (request.method !== 'POST') {
    return response.status(405).json({ error: 'Method Not Allowed.' });
  }

  const { content } = request.body;
  if (!content) {
    return response.status(400).json({ error: 'Content is required.' });
  }

  let emotionKey = 'calm';
  let geminiText = '';
  let fallbackUsed = false;
  let fallbackReason = '';

  // 1단계: Google Gemini 3.1 Flash API 호출 시도 (네트워크 비동기 통신)
  try {
    // 유효한 환경변수 자동 검출 (소문자 우선순위 매핑)
    const apiKey = process.env.gemini_api_key || process.env.Gemini_API_Key || process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY is missing on server.");
    }

    const cleanedApiKey = apiKey.replace(/['"]/g, '').trim();
    // 구글 차세대 3.1 Flash Lite 엔드포인트 세팅
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent`;
    
    // AI 프롬프트 빌드
    const systemInstruction = `너는 심리 상담가야. 사용자가 작성한 일기 내용을 읽고, 사용자의 감정을 한 단어(예: 기쁨, 슬픔, 분노, 불안, 평온)로 요약해 줘. 그리고 그 감정에 공감해 주고 따뜻한 응원의 메시지를 2~3 문장으로 작성해 줘. 답변 형식은 반드시 '감정: [요약된 감정]\n\n[응원메시지]'와 같이 줄바꿈을 포함해서 보내줘

사용자 일기 내용:
"${content}"`;

    const payload = {
      contents: [{ parts: [{ text: systemInstruction }] }]
    };

    // Google API 서버와 소켓 통신 (비동기 대기 - await)
    const apiResponse = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': cleanedApiKey // 구글 9월 새 인증 헤더 적용
      },
      body: JSON.stringify(payload)
    });

    if (!apiResponse.ok) {
      const errorText = await apiResponse.text();
      throw new Error(`Gemini API error status ${apiResponse.status}: ${errorText}`);
    }

    const data = await apiResponse.json();
    geminiText = data.candidates[0].content.parts[0].text.trim();
    
    // 응답 구문 해석 (정규식 파싱)
    const emotionMatch = geminiText.match(/감정\s*:?\s*([^\n\r]+)/);
    let emotionStr = "평온";
    if (emotionMatch && emotionMatch[1]) {
      emotionStr = emotionMatch[1].trim();
    }

    const cleanEmotionStr = emotionStr.replace(/[\[\]]/g, '').trim();
    if (cleanEmotionStr.includes('기쁨') || cleanEmotionStr.includes('행복')) emotionKey = 'joy';
    else if (cleanEmotionStr.includes('슬픔') || cleanEmotionStr.includes('우울')) emotionKey = 'sadness';
    else if (cleanEmotionStr.includes('분노') || cleanEmotionStr.includes('화') || cleanEmotionStr.includes('짜증')) emotionKey = 'anger';
    else if (cleanEmotionStr.includes('불안') || cleanEmotionStr.includes('걱정') || cleanEmotionStr.includes('초조')) emotionKey = 'anxiety';
    else if (cleanEmotionStr.includes('무기력') || cleanEmotionStr.includes('피곤') || cleanEmotionStr.includes('지침')) emotionKey = 'fatigue';
    else if (cleanEmotionStr.includes('평온') || cleanEmotionStr.includes('안정') || cleanEmotionStr.includes('편안')) emotionKey = 'calm';

  } catch (geminiError) {
    // [예외 격리 처리]
    // 만약 구글 API가 먹통이어도 멈추지 않고(try-catch 우회), 로컬 감정 분석 엔진을 가동!
    console.error("Gemini API call failed, falling back to local analysis engine:", geminiError.message);
    fallbackUsed = true;
    fallbackReason = geminiError.message;

    const localResult = performLocalAnalysis(content);
    emotionKey = localResult.emotionKey;
    geminiText = localResult.geminiText;
  }

  // 2단계: Upstash Serverless Redis에 일기 및 AI 답변 동시 백업
  let redisConfig = null;
  const redisUrl = process.env.redis_url || process.env.Redis_URL || process.env.REDIS_URL;
  if (redisUrl) {
    redisConfig = parseRedisUrl(redisUrl);
  }

  let backupSuccess = false;
  let backupErrorMsg = null;

  if (redisConfig) {
    try {
      // 1. 한국 표준시(KST) 구하기 (UTC+9 시간 연산)
      const kstDate = new Date(new Date().getTime() + (9 * 60 * 60 * 1000));
      const yyyy = kstDate.getUTCFullYear();
      const mm = String(kstDate.getUTCMonth() + 1).padStart(2, '0');
      const dd = String(kstDate.getUTCDate()).padStart(2, '0');
      const hh = String(kstDate.getUTCHours()).padStart(2, '0');
      const min = String(kstDate.getUTCMinutes()).padStart(2, '0');
      const ss = String(kstDate.getUTCSeconds()).padStart(2, '0');
      
      // 고유 Key 이름 규칙: 'diary-YYYYMMDDHHMMSS'
      const redisKey = `diary-${yyyy}${mm}${dd}${hh}${min}${ss}`;

      // 구조체 포맷팅 (구조적 JSON 형태로 묶음)
      const valueToSave = {
        content,
        aiResponse: geminiText
      };

      // Upstash REST API를 사용하여 단일 원격 SET 명령어 실행
      const redisResponse = await fetch(redisConfig.restUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${redisConfig.restToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(['SET', redisKey, JSON.stringify(valueToSave)])
      });

      if (!redisResponse.ok) {
        backupErrorMsg = await redisResponse.text();
      } else {
        backupSuccess = true;
      }
    } catch (redisError) {
      backupErrorMsg = redisError.message;
    }
  } else {
    backupErrorMsg = "REDIS_URL configuration is missing on server.";
  }

  // 3단계: HTTP 200 성공 코드와 함께 최종 JSON 결과 출력
  return response.status(200).json({
    success: true,
    primaryEmotion: emotionKey,
    aiResponse: geminiText,
    backupSuccess,
    backupError: backupErrorMsg,
    fallbackUsed,
    fallbackReason
  });
}
```

---

## 3. api/history.js - 일기 히스토리 GET API

이 파일은 데이터베이스에서 예전에 쓴 일기를 일괄 조회합니다. **네트워크 호출 최소화(MGET 일괄 처리)**를 통해 연동 효율을 극대화한 것이 핵심입니다.

```javascript
// api/history.js

function parseRedisUrl(redisUrl) {
  try {
    const cleanedKey = redisUrl.replace(/^['"]|['"]$/g, '').trim();
    const cleanedUrl = cleanedKey.replace(/^rediss?:\/\//, '');
    const [auth, hostPort] = cleanedUrl.split('@');
    const [username, password] = auth.split(':');
    const [host, port] = hostPort.split(':');
    
    return {
      restUrl: `https://${host}`,
      restToken: password
    };
  } catch (e) {
    return null;
  }
}

export default async function handler(request, response) {
  // CORS...
  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');

  if (request.method !== 'GET') {
    return response.status(405).json({ error: 'Method Not Allowed.' });
  }

  let redisConfig = null;
  const redisUrl = process.env.redis_url || process.env.Redis_URL || process.env.REDIS_URL;
  if (redisUrl) {
    redisConfig = parseRedisUrl(redisUrl);
  }

  if (!redisConfig) {
    return response.status(500).json({ success: false, error: "Database configuration missing." });
  }

  try {
    // 1단계: 'diary-*' 와 매칭되는 모든 Key 목록 가져오기 (BASIC의 FILES 나 C의 디렉토리 스캔과 대응)
    const keysResponse = await fetch(redisConfig.restUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${redisConfig.restToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(['KEYS', 'diary-*'])
    });

    if (!keysResponse.ok) {
      const errText = await keysResponse.text();
      throw new Error(`Redis KEYS error: ${errText}`);
    }

    const keysData = await keysResponse.json();
    const diaryKeys = keysData.result || [];

    // 만약 데이터베이스가 깨끗하게 비어 있다면 빈 리스트 리턴
    if (diaryKeys.length === 0) {
      return response.status(200).json({ success: true, history: [] });
    }

    // 2단계: 최적화 핵심 (MGET 다중 읽기)
    // 개별 키마다 네트워크 루프를 돌면 지연시간(Latency)이 큽니다.
    // C언어의 구조체 배열 일괄 메모리 할당(MGET)처럼 한 번에 모든 데이터를 로드합니다.
    const mgetResponse = await fetch(redisConfig.restUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${redisConfig.restToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(['MGET', ...diaryKeys])
    });

    if (!mgetResponse.ok) {
      const errText = await mgetResponse.text();
      throw new Error(`Redis MGET error: ${errText}`);
    }

    const mgetData = await mgetResponse.json();
    const stringValues = mgetData.result || [];

    // 3단계: 가공 및 정렬
    const historyList = [];
    for (let i = 0; i < diaryKeys.length; i++) {
      try {
        const valStr = stringValues[i];
        if (valStr) {
          const parsedVal = JSON.parse(valStr);
          historyList.push({
            key: diaryKeys[i], // 고유 Key (diary-20260707...)
            content: parsedVal.content,
            aiResponse: parsedVal.aiResponse
          });
        }
      } catch (parseErr) {
        // 하나의 레코드가 유실/손상되어도 전체 시스템 조회를 유지
        console.error("Skipping corrupted record:", parseErr);
      }
    }

    // 4단계: 최신순 정렬 (BASIC의 버블정렬이나 C의 qsort와 대응)
    // 문자열 사전식 역순 정렬을 수행하여 diary-20260707220000이 diary-20260707200000보다 앞에 위치하도록 정렬
    historyList.sort((a, b) => b.key.localeCompare(a.key));

    return response.status(200).json({
      success: true,
      history: historyList
    });

  } catch (error) {
    console.error("Failed to load history:", error);
    return response.status(500).json({ success: false, error: error.message });
  }
}
```

---

## 4. 프론트엔드 비동기 바인딩 (app.js 내 동작)

사용자가 일기를 입력하고 `btnAnalyze`를 눌렀을 때, 혹은 페이지가 맨 처음 로드될 때, 위의 두 API를 자바스크립트 내장 `fetch` 모듈을 이용하여 호출하고 화면 DOM에 카드로 끼워 넣는 원리입니다.

```javascript
// app.js 내 loadDiaryHistory() 일부 발췌

async function loadDiaryHistory() {
    const historyList = document.getElementById('history-list');
    if (!historyList) return;

    try {
        // 백엔드 GET /api/history API에 원격 요청 전송 후 대기
        const response = await fetch('/api/history');
        if (response.ok) {
            const data = await response.json();
            if (data.success && data.history) {
                historyList.innerHTML = ''; // 기존의 '히스토리가 없습니다' 텍스트 클리어
                
                if (data.history.length === 0) {
                    historyList.innerHTML = '<p class="history-empty">기록된 일기가 없습니다. 오늘 하루를 일기로 적어보세요.</p>';
                    return;
                }

                // 데이터 수만큼 순회하며 카드 DOM 동적 조립
                data.history.forEach(entry => {
                    try {
                        const rawKey = entry.key;
                        // 정규식 매칭을 사용해 diary-20260707224439 에서 각 숫자를 분리
                        const match = rawKey.match(/diary-(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/);
                        
                        // BASIC의 PRINT USING 포맷처럼 가독성 있는 날짜 문자열로 조합
                        const formattedDate = match 
                            ? `${match[1]}. ${match[2]}. ${match[3]}. ${match[4]}:${match[5]}:${match[6]}` 
                            : rawKey;

                        const card = document.createElement('div');
                        card.className = 'history-card';
                        card.innerHTML = `
                            <div class="history-card-header">
                                <span class="history-card-date"><i data-lucide="calendar"></i> ${formattedDate}</span>
                            </div>
                            <div class="history-card-content">${entry.content || ''}</div>
                            <div class="history-card-ai">
                                <strong>AI 분석 답변:</strong><br>
                                ${(entry.aiResponse || '').replace(/\n/g, '<br>')}
                            </div>
                        `;
                        historyList.appendChild(card);
                    } catch (cardError) {
                        // 특정 카드 렌더링에 예외가 나더라도 나머지 카드의 출력을 보장 (안전 가드)
                        console.error("Failed to render individual card:", cardError);
                    }
                });

                // 동적으로 주입된 카드의 벡터 아이콘(Lucide Icons)을 화면에 예쁘게 그리기
                lucide.createIcons();
            }
        }
    } catch (e) {
        console.error("Network error while fetching diary history:", e);
    }
}
```
