const IG_APP_ID = '936619743392459';
const DEFAULT_PAGE_SIZE = 100;
const FALLBACK_PAGE_SIZE = 12;
const REQUEST_DELAY_MS = 2000;
const PHASE_DELAY_MS = 5000;
const RATE_LIMIT_WAIT_MS = 60000;
const MAX_RETRIES = 3;

export class InstagramAPI {
  #csrftoken;
  #logger;
  #aborted = false;
  #pageSize = DEFAULT_PAGE_SIZE;

  constructor(csrftoken, logger) {
    this.#csrftoken = csrftoken;
    this.#logger = logger;
  }

  abort() {
    this.#aborted = true;
  }

  isAborted() {
    return this.#aborted;
  }

  async #sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async #fetchWithRetry(url, options = {}, retryCount = 0) {
    if (this.#aborted) throw new Error('Scan aborted by user');

    const headers = {
      'x-csrftoken': this.#csrftoken,
      'x-ig-app-id': IG_APP_ID,
      'x-requested-with': 'XMLHttpRequest',
      ...options.headers,
    };

    this.#logger.debug(`Fetching: ${url.substring(0, 120)}...`);

    let response;
    try {
      response = await fetch(url, {
        ...options,
        credentials: 'include',
        headers,
      });
    } catch (err) {
      if (retryCount < MAX_RETRIES) {
        const backoff = Math.pow(2, retryCount) * 2000;
        this.#logger.warn(
          `Network error, retrying in ${backoff}ms (attempt ${retryCount + 1}/${MAX_RETRIES})`,
          { error: err.message, url: url.substring(0, 120) }
        );
        await this.#sleep(backoff);
        return this.#fetchWithRetry(url, options, retryCount + 1);
      }
      throw err;
    }

    if (response.status === 429) {
      if (retryCount < MAX_RETRIES) {
        this.#logger.warn(
          `Rate limited (429). Waiting ${RATE_LIMIT_WAIT_MS / 1000}s before retry ${retryCount + 1}/${MAX_RETRIES}`,
          { url: url.substring(0, 120) }
        );
        await this.#sleep(RATE_LIMIT_WAIT_MS);
        return this.#fetchWithRetry(url, options, retryCount + 1);
      }
      throw new Error(`Rate limited after ${MAX_RETRIES} retries`);
    }

    if (response.status === 401 || response.status === 403) {
      throw new Error(
        `Authentication error (${response.status}). Please make sure you are logged into Instagram.`
      );
    }

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      if (retryCount < MAX_RETRIES) {
        const backoff = Math.pow(2, retryCount) * 2000;
        this.#logger.warn(
          `HTTP ${response.status}, retrying in ${backoff}ms (attempt ${retryCount + 1}/${MAX_RETRIES})`,
          { status: response.status, body: text.substring(0, 200) }
        );
        await this.#sleep(backoff);
        return this.#fetchWithRetry(url, options, retryCount + 1);
      }
      throw new Error(`HTTP ${response.status}: ${text.substring(0, 200)}`);
    }

    return response.json();
  }

  async fetchProfileInfo(userId) {
    this.#logger.info('Fetching profile info', { userId });
    const url = `https://www.instagram.com/api/v1/users/${userId}/info/`;
    const data = await this.#fetchWithRetry(url);
    const user = data.user;
    const profile = {
      pk: user.pk,
      username: user.username,
      full_name: user.full_name,
      follower_count: user.follower_count,
      following_count: user.following_count,
      profile_pic_url: user.profile_pic_url,
    };
    this.#logger.info('Profile fetched', {
      username: profile.username,
      followers: profile.follower_count,
      following: profile.following_count,
    });
    return profile;
  }

  async fetchAllFollowers(userId, totalExpected, onProgress) {
    return this.#paginateList('followers', userId, totalExpected, onProgress);
  }

  async fetchAllFollowing(userId, totalExpected, onProgress) {
    return this.#paginateList('following', userId, totalExpected, onProgress);
  }

  async #paginateList(type, userId, totalExpected, onProgress) {
    this.#logger.info(`Starting to fetch ${type}`, { userId, totalExpected });
    const all = [];
    let maxId = null;
    let page = 0;
    let hasMore = true;

    while (hasMore) {
      if (this.#aborted) throw new Error('Scan aborted by user');

      page++;
      let url = `https://www.instagram.com/api/v1/friendships/${userId}/${type}/?count=${this.#pageSize}&search_surface=follow_list_page`;
      if (maxId) {
        url += `&max_id=${encodeURIComponent(maxId)}`;
      }

      let data;
      try {
        data = await this.#fetchWithRetry(url);
      } catch (err) {
        if (
          this.#pageSize === DEFAULT_PAGE_SIZE &&
          page === 1 &&
          !err.message.includes('aborted') &&
          !err.message.includes('Authentication')
        ) {
          this.#logger.warn(
            `Large page size failed, falling back to count=${FALLBACK_PAGE_SIZE}`,
            { error: err.message }
          );
          this.#pageSize = FALLBACK_PAGE_SIZE;
          url = `https://www.instagram.com/api/v1/friendships/${userId}/${type}/?count=${this.#pageSize}&search_surface=follow_list_page`;
          data = await this.#fetchWithRetry(url);
        } else {
          throw err;
        }
      }

      const users = (data.users || []).map((u) => ({
        pk: String(u.pk),
        username: u.username,
        full_name: u.full_name || '',
        profile_pic_url: u.profile_pic_url || '',
        is_private: u.is_private || false,
        is_verified: u.is_verified || false,
      }));

      all.push(...users);
      hasMore = !!data.has_more && !!data.next_max_id;
      maxId = data.next_max_id || null;

      this.#logger.debug(
        `${type} page ${page}: got ${users.length} users (total: ${all.length}/${totalExpected})`,
        { hasMore, maxIdPresent: !!maxId }
      );

      if (onProgress) {
        onProgress(all.length, totalExpected, page);
      }

      if (hasMore) {
        await this.#sleep(REQUEST_DELAY_MS);
      }
    }

    this.#logger.info(`Finished fetching ${type}`, {
      total: all.length,
      expected: totalExpected,
      pages: page,
    });

    return all;
  }

  async verifyFollowStatus(userIds) {
    // Use show_many endpoint to verify whether we actually follow these users
    // Batches of 50 to avoid oversized requests
    const BATCH_SIZE = 50;
    const results = {};

    for (let i = 0; i < userIds.length; i += BATCH_SIZE) {
      if (this.#aborted) throw new Error('Scan aborted by user');

      const batch = userIds.slice(i, i + BATCH_SIZE);
      this.#logger.debug(`Verifying follow status batch ${Math.floor(i / BATCH_SIZE) + 1}`, {
        count: batch.length,
      });

      const url = 'https://www.instagram.com/api/v1/friendships/show_many/';
      const body = new URLSearchParams();
      body.append('user_ids', batch.join(','));

      const data = await this.#fetchWithRetry(url, {
        method: 'POST',
        body: body.toString(),
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      });

      if (data.friendship_statuses) {
        for (const [pk, status] of Object.entries(data.friendship_statuses)) {
          results[pk] = status;
        }
      }

      if (i + BATCH_SIZE < userIds.length) {
        await this.#sleep(REQUEST_DELAY_MS);
      }
    }

    return results;
  }

  getPhaseDelay() {
    return PHASE_DELAY_MS;
  }
}
