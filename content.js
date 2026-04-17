// Content script: extracts session info from instagram.com cookies
// and sends it to the background service worker.

(function () {
  function extractSessionInfo() {
    const cookies = {};
    document.cookie.split('; ').forEach((c) => {
      const idx = c.indexOf('=');
      if (idx > 0) {
        cookies[c.substring(0, idx)] = c.substring(idx + 1);
      }
    });

    return {
      csrftoken: cookies.csrftoken || null,
      ds_user_id: cookies.ds_user_id || null,
      sessionid: cookies.sessionid || null,
    };
  }

  const session = extractSessionInfo();

  if (session.csrftoken && session.ds_user_id) {
    chrome.runtime.sendMessage({
      type: 'SESSION_INFO',
      payload: session,
    });
  }
})();
