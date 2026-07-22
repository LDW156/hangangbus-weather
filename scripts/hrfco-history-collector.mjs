const REQUIRED = [
  "HRFCO_PALDANG_URL",
  "HRFCO_JAMSU_URL",
  "HRFCO_HANGANG_URL",
  "HISTORY_API_URL",
  "HISTORY_INGEST_TOKEN"
];

for (const name of REQUIRED) {
  if (!process.env[name]) {
    throw new Error(`GitHub Secret 누락: ${name}`);
  }
}

const SOURCES = [
  {
    sourceKey: "paldang",
    url: process.env.HRFCO_PALDANG_URL
  },
  {
    sourceKey: "jamsu",
    url: process.env.HRFCO_JAMSU_URL
  },
  {
    sourceKey: "hangang",
    url: process.env.HRFCO_HANGANG_URL
  }
];

const HISTORY_WINDOW_MINUTES = 360;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function formatApiTime(date) {
  const parts = new Intl.DateTimeFormat(
    "en-CA",
    {
      timeZone: "Asia/Seoul",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23"
    }
  ).formatToParts(date).reduce((acc, item) => {
    acc[item.type] = item.value;
    return acc;
  }, {});

  return (
    `${parts.year}${parts.month}${parts.day}` +
    `${parts.hour}${parts.minute}`
  );
}

function updateTimeWindow(rawUrl) {
  const url = String(rawUrl || "").trim();

  if (!/^https?:\/\//i.test(url)) {
    throw new Error("HRFCO URL 형식 오류");
  }

  const end = new Date(
    Math.floor(Date.now() / 600000) * 600000
  );
  const start = new Date(
    end.getTime() - HISTORY_WINDOW_MINUTES * 60000
  );

  const matches = [...url.matchAll(/\d{12}/g)];

  if (matches.length < 2) {
    return url;
  }

  const first = matches.at(-2);
  const second = matches.at(-1);
  let output = url;

  output =
    output.slice(0, second.index) +
    formatApiTime(end) +
    output.slice(second.index + 12);

  output =
    output.slice(0, first.index) +
    formatApiTime(start) +
    output.slice(first.index + 12);

  return output;
}

function stationCodeFromUrl(rawUrl) {
  const matches = String(rawUrl || "").match(/\d{6,}/g);
  return matches?.at(-1) || null;
}

async function fetchXmlWithRetry(source) {
  const delays = [0, 5000, 15000, 30000];
  let lastError = null;

  for (let attempt = 0; attempt < delays.length; attempt += 1) {
    if (delays[attempt]) {
      await sleep(delays[attempt]);
    }

    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      45000
    );

    try {
      const response = await fetch(
        updateTimeWindow(source.url),
        {
          method: "GET",
          headers: {
            "Accept": "application/xml,text/xml,*/*",
            "User-Agent": "HanGangBUS-GitHub-History/89.2",
            "Cache-Control": "no-cache"
          },
          signal: controller.signal
        }
      );

      const text = await response.text();

      if (!response.ok) {
        throw new Error(
          `HTTP ${response.status}`
        );
      }

      if (!text.includes("<")) {
        throw new Error("XML 응답이 비어 있습니다.");
      }

      return {
        sourceKey: source.sourceKey,
        stationCode: stationCodeFromUrl(source.url),
        xml: text
      };
    } catch (error) {
      lastError = error;
      console.warn(
        `${source.sourceKey} 수집 실패 ` +
        `${attempt + 1}/${delays.length}: ` +
        `${error.message}`
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  throw new Error(
    `${source.sourceKey} 최종 실패: ` +
    `${lastError?.message || "unknown"}`
  );
}

async function main() {
  const collected = [];

  /*
   * HRFCO에 세 요청을 한꺼번에 몰지 않고
   * 순차적으로 호출합니다.
   */
  for (const source of SOURCES) {
    collected.push(
      await fetchXmlWithRetry(source)
    );
    await sleep(1500);
  }

  const endpoint =
    `${process.env.HISTORY_API_URL.replace(/\/+$/, "")}` +
    `/api/ingest`;

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Authorization":
        `Bearer ${process.env.HISTORY_INGEST_TOKEN}`,
      "Content-Type":
        "application/json"
    },
    body: JSON.stringify({
      trigger: "github-actions:10m",
      fetchedAt: new Date().toISOString(),
      sources: collected
    })
  });

  const text = await response.text();
  let result;

  try {
    result = JSON.parse(text);
  } catch (_) {
    throw new Error(
      `History API JSON 오류: ${text.slice(0, 200)}`
    );
  }

  if (!response.ok || !result.ok) {
    throw new Error(
      `History API 저장 실패: ${JSON.stringify(result)}`
    );
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        insertedRows: result.insertedRows,
        rejectedRows: result.rejectedRows,
        results: result.results
      },
      null,
      2
    )
  );
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
