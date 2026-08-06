(() => {
  'use strict';

  const cfg = window.HANGANG_HISTORY_CONFIG || {};
  const $ = id => document.getElementById(id);

  const state = {
    initialized: false,
    source: cfg.DEFAULT_SOURCE || 'bridge',
    mode: 'hourly',
    rows: [],
    response: null,
    chartRows: [],
    chartSeries: [],
    exportUrl: '',
    stats: null,
    rawRows: [],
    annotatedRows: [],
    tableFilter: 'all',
    entry: 'bridge',
    anomalyCutoff: null,
    anomalyMethod: null
  };

  const COLORS = {
    water: '#126fd1',
    clearance: '#e88a16',
    outflow: '#126fd1',
    inflow: '#ec8b18',
    reservoir: '#d64b58',
    grid: '#d9e4ea',
    text: '#557080',
    axis: '#37586b'
  };

  const escapeHtml = value => String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');

  const number = value => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  };

  const optionalNumber = value => {
    if (value === null || value === undefined || String(value).trim() === '') {
      return null;
    }
    return number(value);
  };

  const fmt = (value, digits = 2) => {
    const parsed = number(value);
    return parsed === null
      ? '-'
      : parsed.toLocaleString('ko-KR', {
          minimumFractionDigits: digits,
          maximumFractionDigits: digits
        });
  };

  const fmtAuto = (value, unit = '') => {
    const parsed = number(value);
    if (parsed === null) return '-';
    const digits = Math.abs(parsed) >= 100 ? 0 : 2;
    return `${fmt(parsed, digits)}${unit}`;
  };

  const signed = (value, digits = 2, unit = '') => {
    const parsed = number(value);
    if (parsed === null) return '-';
    return `${parsed > 0 ? '+' : ''}${fmt(parsed, digits)}${unit}`;
  };

  const dateParts = value => {
    const date = value ? new Date(value) : null;
    if (!date || Number.isNaN(date.getTime())) return null;
    return date;
  };

  const formatDateTime = value => {
    const date = dateParts(value);
    return date
      ? date.toLocaleString('ko-KR', {
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
          hour12: false
        })
      : String(value || '-');
  };

  const formatAxisTime = (value, mode) => {
    const date = dateParts(value);
    if (!date) return String(value || '-');

    if (mode === 'hourly') {
      return date.toLocaleTimeString('ko-KR', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
      });
    }

    if (mode === 'daily') {
      return `${String(date.getMonth() + 1).padStart(2, '0')}.${String(date.getDate()).padStart(2, '0')}`;
    }

    return `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, '0')}`;
  };

  function isClearanceVisible() {
    return state.source === 'bridge' && currentTarget() === 'jamsu';
  }

  function headerMeta() {
    if (state.entry === 'search') {
      return {
        eyebrow: 'HYDROLOGY DATA SEARCH',
        title: '조건별 수문 데이터 검색',
        description: '기간·기준값·변화량 순위를 조합하여 필요한 자료만 추출합니다.'
      };
    }

    if (state.entry === 'dam') {
      return {
        eyebrow: 'DAM DISCHARGE ANALYSIS',
        title: '댐 방류량 데이터 분석',
        description: '팔당댐 방류량·유입량 장기 추세와 변화구간을 분석합니다.'
      };
    }

    return {
      eyebrow: 'BRIDGE WATER LEVEL ANALYSIS',
      title: '교량 수위 데이터 분석',
      description: '잠수교·한강대교 수위와 변화구간을 분석합니다.'
    };
  }

  function updateHeaderMeta() {
    const meta = headerMeta();
    $('historyHeaderEyebrow').textContent = meta.eyebrow;
    $('historyMainTitle').textContent = meta.title;
    $('historyHeaderDescription').textContent = meta.description;
  }

  function filterLabels() {
    if (state.source === 'bridge') {
      return {
        all: '전체',
        flagged: '특이점만',
        up: '상승 특이',
        down: '하강 특이'
      };
    }

    return {
      all: '전체',
      flagged: '특이점만',
      up: '증가 특이',
      down: '감소 특이'
    };
  }

  function percentile(values, ratio) {
    if (!values.length) return null;
    const sorted = [...values].sort((a, b) => a - b);
    const index = (sorted.length - 1) * ratio;
    const lower = Math.floor(index);
    const upper = Math.ceil(index);
    if (lower === upper) return sorted[lower];
    const weight = index - lower;
    return sorted[lower] * (1 - weight) + sorted[upper] * weight;
  }

  function anomalyMethod() {
    if (state.entry !== 'search') return 'top10';
    const selected = $('historyStatFilter')?.value || 'all';
    return selected === 'all' ? null : selected;
  }

  function anomalyCutoff(values, method) {
    if (method !== 'top5' && method !== 'top10') return null;

    const valid = values
      .map(value => Math.abs(number(value)))
      .filter(value => value !== null && value > 0);

    if (valid.length < 4) return null;
    return percentile(valid, method === 'top5' ? 0.95 : 0.90);
  }

  function rowDelta(row, rows, index) {
    const aggregated = state.mode !== 'hourly';

    if (state.source === 'bridge') {
      if (!aggregated) {
        return {
          delta: number(row.change_10m_m),
          basis: '10분 수위변화'
        };
      }

      const current = number(row.avg_water_level_m);
      const previous = index > 0
        ? number(rows[index - 1].avg_water_level_m)
        : null;

      return {
        delta: current !== null && previous !== null
          ? current - previous
          : null,
        basis: state.mode === 'daily'
          ? '전일 평균수위 대비'
          : '전월 평균수위 대비'
      };
    }

    if (!aggregated) {
      return {
        delta: number(row.outflow_change_10m),
        basis: '10분 방류변화'
      };
    }

    const current = number(row.avg_outflow_cms);
    const previous = index > 0
      ? number(rows[index - 1].avg_outflow_cms)
      : null;

    return {
      delta: current !== null && previous !== null
        ? current - previous
        : null,
      basis: state.mode === 'daily'
        ? '전일 평균방류량 대비'
        : '전월 평균방류량 대비'
    };
  }

  function annotateRows(rows) {
    const method = anomalyMethod();
    const deltas = rows.map((row, index) => rowDelta(row, rows, index));
    const cutoff = anomalyCutoff(
      deltas.map(item => item.delta),
      method
    );

    state.anomalyCutoff = cutoff;
    state.anomalyMethod = method;

    return rows.map((row, index) => {
      const { delta, basis } = deltas[index];
      const absolute = delta === null ? null : Math.abs(delta);
      const statistical =
        absolute !== null &&
        cutoff !== null &&
        absolute >= cutoff;

      let label = '정상';
      let direction = 'normal';
      let className = '';

      if (delta !== null && delta !== 0) {
        direction = delta > 0 ? 'up' : 'down';
      }

      if (statistical) {
        label = method === 'top5'
          ? '변화량 상위 5%'
          : '변화량 상위 10%';
        className = delta >= 0
          ? 'history-row-spike-up'
          : 'history-row-spike-down';
      }

      if ((row.quality_flag && row.quality_flag !== 'valid') && label === '정상') {
        className = 'history-row-quality';
        label = '자료확인';
      }

      return {
        ...row,
        _anomaly: {
          delta,
          basis,
          label,
          direction,
          className,
          statistical,
          cutoff,
          method,
          noteworthy: label !== '정상'
        }
      };
    });
  }

  function applyAdvancedFilters(rows) {
    if (state.entry !== 'search') return rows;

    const minWater = optionalNumber($('historyWaterMin')?.value);
    const maxClearance = optionalNumber($('historyClearanceMax')?.value);
    const minOutflow = optionalNumber($('historyOutflowMin')?.value);
    const statFilter = $('historyStatFilter')?.value || 'all';
    const aggregated = state.mode !== 'hourly';

    return rows.filter(row => {
      if (state.source === 'bridge') {
        const water = number(
          aggregated ? row.max_water_level_m : row.water_level_m
        );
        if (minWater !== null && (water === null || water < minWater)) {
          return false;
        }

        if (currentTarget() === 'jamsu' && maxClearance !== null) {
          const clearance = number(
            aggregated
              ? row.min_clearance_height_m
              : row.clearance_height_m
          );
          if (clearance === null || clearance > maxClearance) {
            return false;
          }
        }
      } else {
        const outflow = number(
          aggregated ? row.max_outflow_cms : row.outflow_cms
        );
        if (minOutflow !== null && (outflow === null || outflow < minOutflow)) {
          return false;
        }
      }

      if (statFilter !== 'all' && !row._anomaly?.statistical) {
        return false;
      }

      return true;
    });
  }

  function filteredRows() {
    const rows = state.annotatedRows || [];
    switch (state.tableFilter) {
      case 'flagged':
        return rows.filter(row => row._anomaly?.noteworthy);
      case 'up':
        return rows.filter(row => row._anomaly?.direction === 'up' && row._anomaly?.noteworthy);
      case 'down':
        return rows.filter(row => row._anomaly?.direction === 'down' && row._anomaly?.noteworthy);
      default:
        return rows;
    }
  }

  function apiUrl(path, params = {}) {
    const base = String(cfg.API_BASE || '').replace(/\/+$/, '');
    const url = new URL(`${base}${path}`);

    Object.entries(params).forEach(([key, value]) => {
      if (value !== null && value !== undefined && value !== '') {
        url.searchParams.set(key, String(value));
      }
    });

    return url;
  }

  async function fetchJson(path, params = {}) {
    if (!cfg.ENABLED || !cfg.API_BASE) {
      throw new Error('장기 데이터 API 주소가 설정되지 않았습니다.');
    }

    const response = await fetch(apiUrl(path, params).toString(), {
      cache: 'no-store'
    });

    const text = await response.text();
    let parsed;

    try {
      parsed = JSON.parse(text);
    } catch (_) {
      throw new Error(`JSON 응답 오류 · ${text.slice(0, 120)}`);
    }

    if (!response.ok || parsed?.ok === false) {
      throw new Error(
        parsed?.error ||
        `History API HTTP ${response.status}`
      );
    }

    return parsed;
  }

  function localDateKey(date = new Date()) {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Seoul',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).formatToParts(date).reduce((acc, part) => {
      acc[part.type] = part.value;
      return acc;
    }, {});

    return `${parts.year}-${parts.month}-${parts.day}`;
  }

  function localMonthKey(date = new Date()) {
    return localDateKey(date).slice(0, 7);
  }

  function setAdvancedDates() {
    const to = new Date();
    const from = new Date(to.getTime() - 30 * 24 * 3600000);
    const fromInput = $('historyFromDate');
    const toInput = $('historyToDate');

    if (fromInput && !fromInput.value) {
      fromInput.value = localDateKey(from);
      fromInput.min = '2020-01-01';
      fromInput.max = localDateKey(to);
    }

    if (toInput && !toInput.value) {
      toInput.value = localDateKey(to);
      toInput.min = '2020-01-01';
      toInput.max = localDateKey(to);
    }
  }

  function updateAdvancedFieldVisibility() {
    const bridge = state.source === 'bridge';
    const clearanceAvailable = bridge && currentTarget() === 'jamsu';

    $('historyWaterMinField').hidden = !bridge;
    $('historyClearanceMaxField').hidden = !bridge;
    $('historyOutflowMinField').hidden = bridge;

    const clearance = $('historyClearanceMax');
    if (clearance) {
      clearance.disabled = !clearanceAvailable;
      if (!clearanceAvailable) clearance.value = '';
    }
  }

  function applyEntry(entry) {
    const next = ['bridge', 'dam', 'search'].includes(entry)
      ? entry
      : 'bridge';

    state.entry = next;
    state.tableFilter = 'all';

    if (next === 'bridge') state.source = 'bridge';
    if (next === 'dam') state.source = 'dam';

    const sourceTabs = $('historySourceTabs');
    const advancedPanel = $('historyAdvancedPanel');
    const dateField = $('historyDateField');

    sourceTabs?.classList.toggle('is-fixed-source', next !== 'search');
    if (advancedPanel) advancedPanel.hidden = next !== 'search';
    if (dateField) dateField.hidden = next === 'search';

    document.querySelectorAll('[data-history-source]').forEach(button => {
      button.classList.toggle(
        'active',
        button.dataset.historySource === state.source
      );
    });

    setTargetOptions();
    setDateInput();
    setAdvancedDates();
    updateAdvancedFieldVisibility();
    updateHeaderMeta();
    updateStoredRange();
  }

  function setDateInput() {
    const field = $('historyDateField');
    const input = $('historyDate');

    if (state.mode === 'hourly') {
      field.querySelector('span').textContent = '조회일';
      input.type = 'date';
      input.value = localDateKey();
      input.min = '2020-01-01';
      input.max = localDateKey();
      return;
    }

    if (state.mode === 'daily') {
      field.querySelector('span').textContent = '조회월';
      input.type = 'month';
      input.value = localMonthKey();
      input.min = '2020-01';
      input.max = localMonthKey();
      return;
    }

    field.querySelector('span').textContent = '조회연도';
    input.type = 'number';
    input.min = '2020';
    input.max = String(new Date().getFullYear() + 1);
    input.step = '1';
    input.value = String(new Date().getFullYear());
  }

  function setTargetOptions() {
    const select = $('historyTarget');
    const label = $('historyTargetLabel');

    if (state.source === 'bridge') {
      label.textContent = '교량 선택';
      select.innerHTML = `
        <option value="jamsu">잠수교</option>
        <option value="hangang">한강대교</option>
      `;
    } else {
      label.textContent = '댐 선택';
      select.innerHTML = `
        <option value="paldang">팔당댐</option>
      `;
    }
  }

  function rangeForMode() {
    if (state.entry === 'search') {
      const from = $('historyFromDate').value || localDateKey();
      const to = $('historyToDate').value || localDateKey();
      const interval = state.mode === 'hourly'
        ? '10m'
        : state.mode === 'daily'
          ? '1d'
          : '1mo';
      const label = state.mode === 'hourly'
        ? '10분 원자료'
        : state.mode === 'daily'
          ? '일별 통계'
          : '월별 통계';

      if (from > to) {
        throw new Error('시작일은 종료일보다 늦을 수 없습니다.');
      }

      return {
        interval,
        from,
        to,
        display: `${from} ~ ${to} ${label}`
      };
    }

    const raw = $('historyDate').value;

    if (state.mode === 'hourly') {
      const date = raw || localDateKey();
      return {
        interval: '10m',
        from: date,
        to: date,
        display: `${date} 10분 원자료`
      };
    }

    if (state.mode === 'daily') {
      const month = raw || localMonthKey();
      const [year, monthNumber] = month.split('-').map(Number);
      const lastDay = new Date(year, monthNumber, 0).getDate();
      return {
        interval: '1d',
        from: `${month}-01`,
        to: `${month}-${String(lastDay).padStart(2, '0')}`,
        display: `${month} 일별 통계`
      };
    }

    const year = String(raw || new Date().getFullYear());
    return {
      interval: '1mo',
      from: `${year}-01-01`,
      to: `${year}-12-31`,
      display: `${year}년 월별 통계`
    };
  }

  function currentTarget() {
    return $('historyTarget').value;
  }

  function sourceName() {
    if (state.source === 'dam') return '팔당댐';
    return currentTarget() === 'hangang' ? '한강대교' : '잠수교';
  }

  function renderLegendNote() {
    const element = $('historyLegendNote');
    if (!element) return;

    if (state.source === 'bridge') {
      element.innerHTML = isClearanceVisible()
        ? `
          <span><i style="background:${COLORS.water}"></i>파란색 = 수위</span>
          <span><i style="background:${COLORS.clearance}"></i>주황색 = 통과높이</span>
        `
        : `
          <span><i style="background:${COLORS.water}"></i>파란색 = 수위</span>
          <span class="muted">한강대교는 통과높이를 표시하지 않습니다.</span>
        `;
      return;
    }

    element.innerHTML = `
      <span><i style="background:${COLORS.outflow}"></i>파란색 = 방류량</span>
      <span><i style="background:${COLORS.inflow}"></i>주황색 = 유입량</span>
      <span><i style="background:${COLORS.reservoir}"></i>빨간색 = 댐 수위</span>
    `;
  }

  function renderAnomalyToolbar() {
    const bar = $('historyAnomalyToolbar');
    const summary = $('historyAnomalyCount');
    const guide = $('historyAnomalyGuide');
    const filtersWrap = $('historyAnomalyFilters');
    if (!bar || !summary || !guide || !filtersWrap) return;

    const rows = state.annotatedRows || [];
    const labels = filterLabels();
    const counts = {
      all: rows.length,
      flagged: rows.filter(row => row._anomaly?.noteworthy).length,
      up: rows.filter(row => row._anomaly?.direction === 'up' && row._anomaly?.noteworthy).length,
      down: rows.filter(row => row._anomaly?.direction === 'down' && row._anomaly?.noteworthy).length
    };

    summary.textContent = `특이점 ${counts.flagged.toLocaleString('ko-KR')}건`;

    const cutoff = state.anomalyCutoff;
    const methodLabel = state.anomalyMethod === 'top5'
      ? '선택 기간 변화량 상위 5%'
      : state.anomalyMethod === 'top10'
        ? '선택 기간 변화량 상위 10%'
        : null;

    if (!methodLabel) {
      guide.textContent = '변화량 순위 필터를 적용하지 않고 전체 자료를 표시합니다.';
    } else if (cutoff === null) {
      guide.textContent = `${methodLabel}를 계산할 수 있는 변화자료가 부족합니다.`;
    } else {
      guide.textContent = `${methodLabel} 구간을 하이라이트합니다. 임의의 고정 방류량 기준은 사용하지 않습니다.`;
    }

    filtersWrap.innerHTML = ['all', 'flagged', 'up', 'down'].map(key => `
      <button type="button" data-history-filter="${key}" class="${state.tableFilter === key ? 'active' : ''}">${labels[key]} (${counts[key].toLocaleString('ko-KR')})</button>
    `).join('');
  }

  function updateApiStatus(kind, text) {
    const element = $('historyApiStatus');
    element.className = `history-api-status ${kind}`;
    element.textContent = text;
  }

  async function loadStats() {
    try {
      const result = await fetchJson('/api/stats');
      state.stats = result;
      updateApiStatus('normal', 'D1 연결 정상');
      updateStoredRange();
    } catch (error) {
      updateApiStatus('error', 'D1 연결 오류');
      $('historyRangeTitle').textContent = '장기 데이터 API 연결 실패';
      $('historyRangeDescription').textContent = error.message;
    }
  }

  function updateStoredRange() {
    if (!state.stats) return;

    const target = currentTarget();
    const rows = state.source === 'bridge'
      ? state.stats.bridges || []
      : state.stats.dams || [];
    const key = state.source === 'bridge' ? 'station_key' : 'dam_key';
    const row = rows.find(item => item[key] === target);

    if (!row) {
      $('historyRangeTitle').textContent = `${sourceName()} 저장자료 없음`;
      $('historyRangeDescription').textContent =
        '자동수집 또는 수동수집 실행 후 자료가 표시됩니다.';
      return;
    }

    $('historyRangeTitle').textContent =
      `${sourceName()} 누적 ${Number(row.row_count || 0).toLocaleString('ko-KR')}건`;
    $('historyRangeDescription').textContent =
      `저장범위 ${formatDateTime(row.oldest)} ~ ${formatDateTime(row.latest)}`;
  }

  async function searchHistory() {
    const button = $('historySearch');
    const status = $('historyQueryStatus');

    button.disabled = true;
    button.textContent = '조회 중';
    status.textContent = '자료 조회 중';
    status.className = 'loading';

    try {
      const range = rangeForMode();
      const target = currentTarget();
      const path = state.source === 'bridge'
        ? '/api/bridges'
        : '/api/dams';
      const params = state.source === 'bridge'
        ? {
            station: target,
            interval: range.interval,
            from: range.from,
            to: range.to,
            minWater: state.entry === 'search'
              ? $('historyWaterMin').value
              : '',
            maxClearance: state.entry === 'search' && target === 'jamsu'
              ? $('historyClearanceMax').value
              : ''
          }
        : {
            dam: target,
            interval: range.interval,
            from: range.from,
            to: range.to,
            minOutflow: state.entry === 'search'
              ? $('historyOutflowMin').value
              : ''
          };

      const result = await fetchJson(path, params);
      state.response = result;
      state.rawRows = Array.isArray(result.rows) ? result.rows : [];
      const annotated = annotateRows(state.rawRows);
      state.annotatedRows = applyAdvancedFilters(annotated);
      state.rows = state.annotatedRows;

      const exportPath = state.source === 'bridge'
        ? '/api/export/bridges.csv'
        : '/api/export/dams.csv';

      state.exportUrl = apiUrl(exportPath, params).toString();
      $('historyExport').disabled = !state.rows.length;

      renderAll(range);

      status.textContent = state.entry === 'search'
        ? `원자료 ${state.rawRows.length.toLocaleString('ko-KR')}건 · 조건충족 ${state.rows.length.toLocaleString('ko-KR')}건`
        : `${state.rows.length.toLocaleString('ko-KR')}건 조회`;
      status.className = 'normal';
    } catch (error) {
      state.rows = [];
      state.rawRows = [];
      state.annotatedRows = [];
      state.response = null;
      state.exportUrl = '';
      $('historyExport').disabled = true;
      renderError(error.message);
      status.textContent = '조회 실패';
      status.className = 'error';
    } finally {
      button.disabled = false;
      button.textContent = '조회';
    }
  }

  function normalizedRows() {
    const aggregated = state.mode !== 'hourly';

    return state.rows.map(row => {
      if (state.source === 'bridge') {
        return {
          time: aggregated ? row.bucket : row.observed_at,
          sampleCount: number(row.sample_count),
          water: number(
            aggregated ? row.avg_water_level_m : row.water_level_m
          ),
          waterMin: number(
            aggregated ? row.min_water_level_m : row.water_level_m
          ),
          waterMax: number(
            aggregated ? row.max_water_level_m : row.water_level_m
          ),
          clearance: number(
            aggregated ? row.avg_clearance_height_m : row.clearance_height_m
          ),
          clearanceMin: number(
            aggregated ? row.min_clearance_height_m : row.clearance_height_m
          ),
          clearanceMax: number(
            aggregated ? row.max_clearance_height_m : row.clearance_height_m
          ),
          raw: row
        };
      }

      return {
        time: aggregated ? row.bucket : row.observed_at,
        sampleCount: number(row.sample_count),
        reservoir: number(
          aggregated ? row.avg_reservoir_level_m : row.reservoir_level_m
        ),
        reservoirMin: number(
          aggregated ? row.min_reservoir_level_m : row.reservoir_level_m
        ),
        reservoirMax: number(
          aggregated ? row.max_reservoir_level_m : row.reservoir_level_m
        ),
        inflow: number(
          aggregated ? row.avg_inflow_cms : row.inflow_cms
        ),
        inflowMin: number(
          aggregated ? row.min_inflow_cms : row.inflow_cms
        ),
        inflowMax: number(
          aggregated ? row.max_inflow_cms : row.inflow_cms
        ),
        outflow: number(
          aggregated ? row.avg_outflow_cms : row.outflow_cms
        ),
        outflowMin: number(
          aggregated ? row.min_outflow_cms : row.outflow_cms
        ),
        outflowMax: number(
          aggregated ? row.max_outflow_cms : row.outflow_cms
        ),
        raw: row
      };
    });
  }

  function renderAll(range) {
    const normalized = normalizedRows();
    state.chartRows = normalized;

    renderSummary(normalized, range);
    renderChart(normalized);
    renderLegendNote();
    renderAnomalyToolbar();
    renderTable();
    updateStoredRange();

    $('historyChartEyebrow').textContent =
      state.source === 'bridge'
        ? '교량 수위 장기추세'
        : '댐 방류량 장기추세';
    $('historyChartTitle').textContent =
      `${sourceName()} ${range.display}`;
    $('historyTableNote').textContent =
      `${sourceName()} · ${range.display} · 하이라이트 행은 변화가 큰 구간`;
  }

  function values(rows, key) {
    return rows
      .map(row => number(row[key]))
      .filter(value => value !== null);
  }

  function minValue(list) {
    return list.length ? Math.min(...list) : null;
  }

  function maxValue(list) {
    return list.length ? Math.max(...list) : null;
  }

  function averageValue(list) {
    return list.length
      ? list.reduce((sum, value) => sum + value, 0) / list.length
      : null;
  }

  function summaryCard(index, label, value, note) {
    const cards = $('historySummary').querySelectorAll('article');
    const card = cards[index];
    card.querySelector('span').textContent = label;
    card.querySelector('b').textContent = value;
    card.querySelector('em').textContent = note;
  }

  function renderSummary(rows, range) {
    summaryCard(
      0,
      '조회 건수',
      `${rows.length.toLocaleString('ko-KR')}건`,
      range.display
    );

    if (!rows.length) {
      summaryCard(1, '최근·평균값', '-', '자료 없음');
      summaryCard(2, '최고값', '-', '자료 없음');
      summaryCard(3, '최저값', '-', '자료 없음');
      return;
    }

    if (state.source === 'bridge') {
      const water = values(rows, 'water');
      const latest = rows.at(-1);
      const clearanceVisible = isClearanceVisible();

      summaryCard(
        1,
        state.mode === 'hourly' ? '최근 수위' : '평균 수위',
        state.mode === 'hourly'
          ? fmtAuto(latest.water, 'm')
          : fmtAuto(averageValue(water), 'm'),
        clearanceVisible && latest.clearance !== null
          ? `통과높이 ${fmtAuto(latest.clearance, 'm')}`
          : `${sourceName()} 장기 수위`
      );
      summaryCard(
        2,
        '최고 수위',
        fmtAuto(maxValue(water), 'm'),
        clearanceVisible
          ? `최저 통과높이 ${fmtAuto(minValue(values(rows, 'clearance')), 'm')}`
          : `평균 ${fmtAuto(averageValue(water), 'm')}`
      );
      summaryCard(
        3,
        '최저 수위',
        fmtAuto(minValue(water), 'm'),
        clearanceVisible
          ? `평균 ${fmtAuto(averageValue(water), 'm')}`
          : `변동폭 ${fmtAuto(maxValue(water) - minValue(water), 'm')}`
      );
      return;
    }

    const outflow = values(rows, 'outflow');
    const inflow = values(rows, 'inflow');
    const latest = rows.at(-1);

    summaryCard(
      1,
      state.mode === 'hourly' ? '최근 방류량' : '평균 방류량',
      state.mode === 'hourly'
        ? fmtAuto(latest.outflow, '㎥/s')
        : fmtAuto(averageValue(outflow), '㎥/s'),
      `유입 ${fmtAuto(latest.inflow, '㎥/s')}`
    );
    summaryCard(
      2,
      '최대 방류량',
      fmtAuto(maxValue(outflow), '㎥/s'),
      `최대 유입 ${fmtAuto(maxValue(inflow), '㎥/s')}`
    );
    summaryCard(
      3,
      '최소 방류량',
      fmtAuto(minValue(outflow), '㎥/s'),
      `평균 ${fmtAuto(averageValue(outflow), '㎥/s')}`
    );
  }

  function seriesForRows(rows) {
    if (state.source === 'bridge') {
      const series = [
        {
          key: 'water',
          label: '수위',
          unit: 'm',
          color: COLORS.water,
          axis: 'left'
        }
      ];

      if (isClearanceVisible() && rows.some(row => row.clearance !== null)) {
        series.push({
          key: 'clearance',
          label: '통과높이',
          unit: 'm',
          color: COLORS.clearance,
          axis: 'right'
        });
      }

      return series;
    }

    const series = [
      {
        key: 'outflow',
        label: '방류량',
        unit: '㎥/s',
        color: COLORS.outflow,
        axis: 'left'
      },
      {
        key: 'inflow',
        label: '유입량',
        unit: '㎥/s',
        color: COLORS.inflow,
        axis: 'left'
      }
    ];

    if (rows.some(row => row.reservoir !== null)) {
      series.push({
        key: 'reservoir',
        label: '댐 수위',
        unit: 'm',
        color: COLORS.reservoir,
        axis: 'right'
      });
    }

    return series;
  }

  function extent(rows, series, axis) {
    const valuesList = [];

    series
      .filter(item => item.axis === axis)
      .forEach(item => {
        rows.forEach(row => {
          const value = number(row[item.key]);
          if (value !== null) valuesList.push(value);
        });
      });

    if (!valuesList.length) return { min: 0, max: 1 };

    let min = Math.min(...valuesList);
    let max = Math.max(...valuesList);

    if (min === max) {
      const pad = Math.abs(min) * 0.05 || 1;
      min -= pad;
      max += pad;
    } else {
      const pad = (max - min) * 0.12;
      min -= pad;
      max += pad;
    }

    return { min, max };
  }

  function pathFor(rows, key, scaleX, scaleY) {
    let started = false;
    let path = '';

    rows.forEach((row, index) => {
      const value = number(row[key]);
      if (value === null) return;

      const command = started ? 'L' : 'M';
      path += `${command}${scaleX(index).toFixed(2)},${scaleY(value).toFixed(2)} `;
      started = true;
    });

    return path.trim();
  }

  function renderChart(rows) {
    const svg = $('historyChart');
    const legend = $('historyLegend');
    const tooltip = $('historyTooltip');

    tooltip.hidden = true;

    if (!rows.length) {
      state.chartSeries = [];
      svg.innerHTML = `
        <rect x="0" y="0" width="1200" height="340" fill="#ffffff"></rect>
        <text x="600" y="170" text-anchor="middle" fill="#6e8795" font-size="18" font-weight="800">
          조회된 자료가 없습니다.
        </text>
      `;
      legend.innerHTML = '';
      return;
    }

    const series = seriesForRows(rows);
    state.chartSeries = series;

    const width = 1200;
    const height = 340;
    const margin = { left: 76, right: 76, top: 28, bottom: 64 };
    const plotWidth = width - margin.left - margin.right;
    const plotHeight = height - margin.top - margin.bottom;

    const leftExtent = extent(rows, series, 'left');
    const rightExtent = extent(rows, series, 'right');

    const scaleX = index =>
      margin.left +
      (rows.length === 1
        ? plotWidth / 2
        : (index / (rows.length - 1)) * plotWidth);

    const makeScaleY = range => value =>
      margin.top +
      ((range.max - value) / (range.max - range.min)) * plotHeight;

    const leftY = makeScaleY(leftExtent);
    const rightY = makeScaleY(rightExtent);

    const grid = [];
    const axisLabels = [];

    for (let tick = 0; tick <= 5; tick += 1) {
      const y = margin.top + (tick / 5) * plotHeight;
      const leftValue =
        leftExtent.max -
        (tick / 5) * (leftExtent.max - leftExtent.min);

      grid.push(
        `<line x1="${margin.left}" y1="${y}" x2="${width - margin.right}" y2="${y}" stroke="${COLORS.grid}" stroke-width="1"/>`
      );
      axisLabels.push(
        `<text x="${margin.left - 12}" y="${y + 4}" text-anchor="end" fill="${COLORS.text}" font-size="12">${escapeHtml(fmt(leftValue, Math.abs(leftValue) >= 100 ? 0 : 2))}</text>`
      );

      if (series.some(item => item.axis === 'right')) {
        const rightValue =
          rightExtent.max -
          (tick / 5) * (rightExtent.max - rightExtent.min);
        axisLabels.push(
          `<text x="${width - margin.right + 12}" y="${y + 4}" text-anchor="start" fill="${COLORS.text}" font-size="12">${escapeHtml(fmt(rightValue, 2))}</text>`
        );
      }
    }

    const labelIndexes = new Set();
    const labelCount = Math.min(9, rows.length);
    for (let i = 0; i < labelCount; i += 1) {
      labelIndexes.add(
        Math.round((i / Math.max(1, labelCount - 1)) * (rows.length - 1))
      );
    }

    const xLabels = [...labelIndexes].map(index => {
      const x = scaleX(index);
      return `
        <line x1="${x}" y1="${height - margin.bottom}" x2="${x}" y2="${height - margin.bottom + 6}" stroke="${COLORS.axis}"/>
        <text
          x="${x}"
          y="${height - margin.bottom + 24}"
          text-anchor="middle"
          fill="${COLORS.text}"
          font-size="11"
        >${escapeHtml(formatAxisTime(rows[index].time, state.mode))}</text>
      `;
    }).join('');

    const paths = series.map(item => {
      const yScale = item.axis === 'right' ? rightY : leftY;
      return `
        <path
          d="${pathFor(rows, item.key, scaleX, yScale)}"
          fill="none"
          stroke="${item.color}"
          stroke-width="3.2"
          stroke-linejoin="round"
          stroke-linecap="round"
        ></path>
      `;
    }).join('');

    svg.innerHTML = `
      <rect x="0" y="0" width="${width}" height="${height}" rx="12" fill="#ffffff"></rect>
      ${grid.join('')}
      <line x1="${margin.left}" y1="${margin.top}" x2="${margin.left}" y2="${height - margin.bottom}" stroke="${COLORS.axis}" stroke-width="1.2"></line>
      <line x1="${width - margin.right}" y1="${margin.top}" x2="${width - margin.right}" y2="${height - margin.bottom}" stroke="${COLORS.axis}" stroke-width="1.2"></line>
      <line x1="${margin.left}" y1="${height - margin.bottom}" x2="${width - margin.right}" y2="${height - margin.bottom}" stroke="${COLORS.axis}" stroke-width="1.2"></line>
      ${axisLabels.join('')}
      ${xLabels}
      ${paths}
      <line id="historyHoverLine" x1="0" y1="${margin.top}" x2="0" y2="${height - margin.bottom}" stroke="#35586a" stroke-width="1.2" stroke-dasharray="5 4" visibility="hidden"></line>
      <g id="historyHoverPoints"></g>
      <rect
        id="historyPointerLayer"
        x="${margin.left}"
        y="${margin.top}"
        width="${plotWidth}"
        height="${plotHeight}"
        fill="transparent"
        data-left="${margin.left}"
        data-width="${plotWidth}"
      ></rect>
    `;

    legend.innerHTML = series.map(item => `
      <span>
        <i style="background:${item.color}"></i>
        ${escapeHtml(item.label)}
      </span>
    `).join('');
  }

  function tooltipRows(row) {
    const rows = [
      `<b>${escapeHtml(formatDateTime(row.time))}</b>`
    ];

    state.chartSeries.forEach(item => {
      rows.push(
        `<span><i style="background:${item.color}"></i>${escapeHtml(item.label)} <strong>${escapeHtml(fmtAuto(row[item.key], item.unit))}</strong></span>`
      );
    });

    if (row.sampleCount !== null) {
      rows.push(
        `<em>표본 ${row.sampleCount.toLocaleString('ko-KR')}건</em>`
      );
    }

    return rows.join('');
  }

  function bindChartPointer() {
    const wrap = $('historyChartWrap');

    wrap.addEventListener('pointermove', event => {
      if (!state.chartRows.length) return;

      const svg = $('historyChart');
      const layer = $('historyPointerLayer');
      const line = $('historyHoverLine');
      const points = $('historyHoverPoints');

      if (!layer || !line || !points) return;

      const rect = svg.getBoundingClientRect();
      const viewX = ((event.clientX - rect.left) / rect.width) * 1200;
      const left = Number(layer.dataset.left);
      const plotWidth = Number(layer.dataset.width);
      const ratio = Math.max(0, Math.min(1, (viewX - left) / plotWidth));
      const index = Math.round(ratio * (state.chartRows.length - 1));
      const row = state.chartRows[index];
      const x = left + (index / Math.max(1, state.chartRows.length - 1)) * plotWidth;

      line.setAttribute('x1', x);
      line.setAttribute('x2', x);
      line.setAttribute('visibility', 'visible');

      const plotTop = 28;
      const plotHeight = 248;
      const leftSeries = state.chartSeries.filter(item => item.axis === 'left');
      const rightSeries = state.chartSeries.filter(item => item.axis === 'right');
      const leftRange = extent(state.chartRows, state.chartSeries, 'left');
      const rightRange = extent(state.chartRows, state.chartSeries, 'right');

      const pointMarkup = state.chartSeries.map(item => {
        const value = number(row[item.key]);
        if (value === null) return '';

        const range = item.axis === 'right' ? rightRange : leftRange;
        const y =
          plotTop +
          ((range.max - value) / (range.max - range.min)) * plotHeight;

        return `<circle cx="${x}" cy="${y}" r="5" fill="${item.color}" stroke="#ffffff" stroke-width="2.5"></circle>`;
      }).join('');

      points.innerHTML = pointMarkup;

      const tooltip = $('historyTooltip');
      tooltip.innerHTML = tooltipRows(row);
      tooltip.hidden = false;

      const wrapRect = wrap.getBoundingClientRect();
      const desiredLeft = event.clientX - wrapRect.left + 14;
      const maxLeft = wrap.clientWidth - 210;
      tooltip.style.left = `${Math.max(8, Math.min(maxLeft, desiredLeft))}px`;
      tooltip.style.top = `${Math.max(8, event.clientY - wrapRect.top - 38)}px`;
    });

    wrap.addEventListener('pointerleave', () => {
      const line = $('historyHoverLine');
      const points = $('historyHoverPoints');
      if (line) line.setAttribute('visibility', 'hidden');
      if (points) points.innerHTML = '';
      $('historyTooltip').hidden = true;
    });
  }

  function tableDefinition() {
    const aggregated = state.mode !== 'hourly';
    const clearanceVisible = isClearanceVisible();

    if (state.source === 'bridge') {
      if (!aggregated) {
        const definition = [
          ['관측시각', row => formatDateTime(row.observed_at)],
          ['수위(m)', row => fmt(row.water_level_m, 2)]
        ];

        if (clearanceVisible) {
          definition.push(['통과높이(m)', row => fmt(row.clearance_height_m, 2)]);
        }

        definition.push(
          ['특이', row => row._anomaly?.label || '정상'],
          ['10분 변화', row => signed(row.change_10m_m, 2, 'm')],
          ['30분 변화', row => signed(row.change_30m_m, 2, 'm')],
          ['1시간 변화', row => signed(row.change_60m_m, 2, 'm')],
          ['자료상태', row => row.quality_flag || '-'],
          ['수집시각', row => formatDateTime(row.collected_at)]
        );

        return definition;
      }

      const definition = [
        ['구간', row => formatDateTime(row.bucket)],
        ['특이', row => row._anomaly?.label || '정상'],
        ['표본', row => fmt(row.sample_count, 0)],
        ['최저수위', row => fmt(row.min_water_level_m, 2)],
        ['평균수위', row => fmt(row.avg_water_level_m, 2)],
        ['최고수위', row => fmt(row.max_water_level_m, 2)]
      ];

      if (clearanceVisible) {
        definition.push(
          ['최저 통과높이', row => fmt(row.min_clearance_height_m, 2)],
          ['평균 통과높이', row => fmt(row.avg_clearance_height_m, 2)],
          ['최고 통과높이', row => fmt(row.max_clearance_height_m, 2)]
        );
      }

      return definition;
    }

    if (!aggregated) {
      return [
        ['관측시각', row => formatDateTime(row.observed_at)],
        ['특이', row => row._anomaly?.label || '정상'],
        ['댐수위(m)', row => fmt(row.reservoir_level_m, 2)],
        ['유입량(㎥/s)', row => fmt(row.inflow_cms, 0)],
        ['방류량(㎥/s)', row => fmt(row.outflow_cms, 0)],
        ['총방류량(㎥/s)', row => fmt(row.total_discharge_cms, 0)],
        ['10분 방류변화', row => signed(row.outflow_change_10m, 0, '㎥/s')],
        ['1시간 방류변화', row => signed(row.outflow_change_60m, 0, '㎥/s')],
        ['자료상태', row => row.quality_flag || '-'],
        ['수집시각', row => formatDateTime(row.collected_at)]
      ];
    }

    return [
      ['구간', row => formatDateTime(row.bucket)],
      ['특이', row => row._anomaly?.label || '정상'],
      ['표본', row => fmt(row.sample_count, 0)],
      ['평균 댐수위', row => fmt(row.avg_reservoir_level_m, 2)],
      ['최저 유입량', row => fmt(row.min_inflow_cms, 0)],
      ['평균 유입량', row => fmt(row.avg_inflow_cms, 0)],
      ['최고 유입량', row => fmt(row.max_inflow_cms, 0)],
      ['최저 방류량', row => fmt(row.min_outflow_cms, 0)],
      ['평균 방류량', row => fmt(row.avg_outflow_cms, 0)],
      ['최고 방류량', row => fmt(row.max_outflow_cms, 0)]
    ];
  }

  function renderTable() {
    const table = $('historyTable');
    const head = table.querySelector('thead');
    const body = table.querySelector('tbody');
    const definition = tableDefinition();
    const visibleRows = filteredRows();

    $('historyTableTitle').textContent = state.tableFilter === 'all'
      ? `목록(${visibleRows.length.toLocaleString('ko-KR')})`
      : `목록(${visibleRows.length.toLocaleString('ko-KR')} / ${state.annotatedRows.length.toLocaleString('ko-KR')})`;

    head.innerHTML = `
      <tr>
        ${definition.map(([label]) => `<th>${escapeHtml(label)}</th>`).join('')}
      </tr>
    `;

    if (!visibleRows.length) {
      body.innerHTML = `
        <tr>
          <td class="history-empty-cell" colspan="${definition.length}">
            현재 필터 조건에 해당하는 자료가 없습니다.
          </td>
        </tr>
      `;
      return;
    }

    body.innerHTML = visibleRows.slice(0, 1000).map(row => `
      <tr class="${row._anomaly?.className || ''}">
        ${definition.map(([, getter]) => `<td>${escapeHtml(getter(row))}</td>`).join('')}
      </tr>
    `).join('');
  }

  function csvCell(value) {
    const text = String(value ?? '');
    return `"${text.replace(/"/g, '""')}"`;
  }

  function downloadFilteredCsv() {
    const definition = tableDefinition();
    const rows = filteredRows();
    const lines = [
      definition.map(([label]) => csvCell(label)).join(','),
      ...rows.map(row =>
        definition.map(([, getter]) => csvCell(getter(row))).join(',')
      )
    ];

    const blob = new Blob(
      ['\uFEFF' + lines.join('\r\n')],
      { type: 'text/csv;charset=utf-8' }
    );
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `hangangbus_${state.source}_${currentTarget()}_${Date.now()}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  function renderError(message) {
    $('historyChart').innerHTML = `
      <rect x="0" y="0" width="1200" height="340" fill="#ffffff"></rect>
      <text x="600" y="158" text-anchor="middle" fill="#b02635" font-size="18" font-weight="900">
        과거자료 조회 실패
      </text>
      <text x="600" y="188" text-anchor="middle" fill="#6d8290" font-size="13">
        ${escapeHtml(message)}
      </text>
    `;

    $('historyLegend').innerHTML = '';
    $('historyLegendNote').innerHTML = '';
    $('historyAnomalyCount').textContent = '특이점 0건';
    $('historyAnomalyGuide').textContent = '변화가 큰 자료를 따로 골라볼 수 있습니다.';
    $('historyAnomalyFilters').innerHTML = '';
    $('historyTable').querySelector('thead').innerHTML = '';
    $('historyTable').querySelector('tbody').innerHTML = `
      <tr>
        <td class="history-empty-cell">${escapeHtml(message)}</td>
      </tr>
    `;
    $('historyTableTitle').textContent = '목록(0)';
  }

  function sourceChanged(source) {
    state.source = source;
    state.tableFilter = 'all';
    updateHeaderMeta();

    document.querySelectorAll('[data-history-source]').forEach(button => {
      button.classList.toggle(
        'active',
        button.dataset.historySource === source
      );
    });

    setTargetOptions();
    updateAdvancedFieldVisibility();
    updateStoredRange();
    $('historyExport').disabled = true;
    state.exportUrl = '';
  }

  function modeChanged(mode) {
    state.mode = mode;
    state.tableFilter = 'all';
    setDateInput();
    $('historyExport').disabled = true;
    state.exportUrl = '';
  }

  function init() {
    if (state.initialized) return;
    state.initialized = true;

    applyEntry('bridge');
    bindChartPointer();

    document.querySelectorAll('[data-history-source]').forEach(button => {
      button.addEventListener('click', () => {
        if (button.disabled) return;
        sourceChanged(button.dataset.historySource);
        searchHistory();
      });
    });

    document.querySelectorAll('input[name="historyMode"]').forEach(input => {
      input.addEventListener('change', () => {
        if (!input.checked) return;
        modeChanged(input.value);
      });
    });

    $('historyTarget').addEventListener('change', () => {
      updateAdvancedFieldVisibility();
      updateStoredRange();
      $('historyExport').disabled = true;
      state.exportUrl = '';
    });

    $('historyAnomalyFilters').addEventListener('click', event => {
      const button = event.target.closest('button[data-history-filter]');
      if (!button) return;
      state.tableFilter = button.dataset.historyFilter || 'all';
      renderAnomalyToolbar();
      renderTable();
    });

    $('historySearch').addEventListener('click', searchHistory);

    $('historyExport').addEventListener('click', () => {
      if (state.entry === 'search') {
        if (!state.annotatedRows.length) return;
        downloadFilteredCsv();
        return;
      }

      if (!state.exportUrl) return;
      window.open(state.exportUrl, '_blank', 'noopener');
    });

    loadStats();
  }

  window.addEventListener('hangangbus-history-open', event => {
    init();
    applyEntry(event.detail?.entry || 'bridge');
    searchHistory();
  });

  init();
})();
