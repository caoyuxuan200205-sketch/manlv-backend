const fetchFeishuApi = async (method, path, userToken, options = {}) => {
  const url = `https://open.feishu.cn/open-apis${path}`;
  
  const headers = {
    'Authorization': `Bearer ${userToken}`,
    ...options.headers
  };

  if (method !== 'GET' && method !== 'HEAD' && options.body) {
    headers['Content-Type'] = 'application/json; charset=utf-8';
  }

  const response = await fetch(url, {
    method,
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined
  });

  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch (err) {
    throw new Error(`飞书 API 响应不是合法的 JSON: ${text.slice(0, 100)}`);
  }

  if (!response.ok || (data.code !== undefined && data.code !== 0)) {
    throw new Error(data.msg || `Feishu API Error ${response.status}`);
  }

  return data;
};

const createLarkApiRuntime = () => {

  const searchDocs = async (userToken, { query = '', pageSize = 10 } = {}) => {
    try {
      // https://open.feishu.cn/open-apis/search/v2/app
      const data = await fetchFeishuApi('POST', '/search/v2/app', userToken, {
        body: {
          query,
          page_size: pageSize
        }
      });
      return { ok: true, data };
    } catch (error) {
      return { ok: false, error: error.message || '搜索飞书文档失败' };
    }
  };

  const fetchDoc = async (userToken, { doc, apiVersion = 'v2', limit, offset } = {}) => {
    if (!doc) return { ok: false, error: 'doc 参数缺失' };
    try {
      // https://open.feishu.cn/open-apis/docx/v1/documents/:document_id/raw_content
      const docId = doc.split('/').pop().split('?')[0]; // Extract token from URL if needed
      const data = await fetchFeishuApi('GET', `/docx/v1/documents/${docId}/raw_content`, userToken);
      return { ok: true, data };
    } catch (error) {
      return { ok: false, error: error.message || '读取飞书文档失败' };
    }
  };

  const createDoc = async (userToken, { content, docFormat = 'xml', apiVersion = 'v2', parentToken, parentPosition } = {}) => {
    try {
      let folderToken = parentToken;
      const data = await fetchFeishuApi('POST', '/docx/v1/documents', userToken, {
        body: {
          folder_token: folderToken,
          title: '新建文档'
        }
      });
      return { ok: true, data };
    } catch (error) {
      return { ok: false, error: error.message || '创建飞书文档失败' };
    }
  };

  const updateDoc = async (userToken, { doc, command, content, docFormat = 'xml', apiVersion = 'v2', pattern, blockId, srcBlockIds, revisionId } = {}) => {
    // 简化版：无法完全复现 cli 的复杂更新，这里返回提示信息让用户知晓
    return { ok: false, error: '原生的更新能力需要详细的块操作，当前已切换至直接 OpenAPI 模式，暂不开放此复杂指令' };
  };

  const getCalendarAgenda = async (userToken, { start, end, calendarId = 'primary', format = 'json' } = {}) => {
    try {
      let path = `/calendar/v4/calendars/${calendarId}/events`;
      const queryParams = new URLSearchParams();
      if (start) queryParams.append('start_time', Math.floor(new Date(start).getTime() / 1000));
      if (end) queryParams.append('end_time', Math.floor(new Date(end).getTime() / 1000));
      if (queryParams.toString()) path += `?${queryParams.toString()}`;

      const data = await fetchFeishuApi('GET', path, userToken);
      return { ok: true, data };
    } catch (error) {
      return { ok: false, error: error.message || '查询飞书日程失败' };
    }
  };

  const createCalendarEvent = async (userToken, { summary, start, end, description, attendeeIds, calendarId = 'primary', rrule, dryRun = false } = {}) => {
    try {
      const data = await fetchFeishuApi('POST', `/calendar/v4/calendars/${calendarId}/events`, userToken, {
        body: {
          summary,
          description,
          start_time: {
            timestamp: String(Math.floor(new Date(start).getTime() / 1000))
          },
          end_time: {
            timestamp: String(Math.floor(new Date(end).getTime() / 1000))
          }
        }
      });
      return { ok: true, data };
    } catch (error) {
      return { ok: false, error: error.message || '创建飞书日程失败' };
    }
  };

  const listDriveFiles = async (userToken, { folderToken = '', orderBy = 'EditedTime', direction = 'DESC', pageSize = 20, pageAll = false, pageLimit = 3 } = {}) => {
    try {
      const queryParams = new URLSearchParams({
        page_size: pageSize,
        order_by: orderBy,
        direction: direction
      });
      if (folderToken) {
        queryParams.append('folder_token', folderToken);
      }
      
      const data = await fetchFeishuApi('GET', `/drive/v1/files?${queryParams.toString()}`, userToken);
      return { ok: true, data };
    } catch (error) {
      return { ok: false, error: error.message || '读取飞书云盘文件列表失败' };
    }
  };

  return {
    searchDocs,
    fetchDoc,
    createDoc,
    updateDoc,
    getCalendarAgenda,
    createCalendarEvent,
    listDriveFiles
  };
};

module.exports = {
  createLarkApiRuntime
};
