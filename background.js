import { Logger } from './lib/logger.js';
import { InstagramAPI } from './lib/api.js';
import {
  getScanState,
  setScanState,
  defaultScanState,
  getSession,
  setSession,
  getProfile,
  setProfile,
  getResults,
  setResults,
  getHistory,
  pushHistory,
} from './lib/storage.js';

const logger = new Logger();
let currentApi = null;

// --- Session helpers ---

async function resolveSession() {
  // Try stored session first
  let session = await getSession();
  if (session && session.csrftoken && session.ds_user_id) {
    logger.debug('Using stored session', { userId: session.ds_user_id });
    return session;
  }

  // Fallback: read cookies via chrome.cookies API
  logger.info('No stored session, reading cookies via chrome.cookies API');
  try {
    const [csrf, userId, sid] = await Promise.all([
      chrome.cookies.get({ url: 'https://www.instagram.com', name: 'csrftoken' }),
      chrome.cookies.get({ url: 'https://www.instagram.com', name: 'ds_user_id' }),
      chrome.cookies.get({ url: 'https://www.instagram.com', name: 'sessionid' }),
    ]);

    if (csrf && userId) {
      session = {
        csrftoken: csrf.value,
        ds_user_id: userId.value,
        sessionid: sid ? sid.value : null,
      };
      await setSession(session);
      logger.info('Session resolved from cookies', { userId: session.ds_user_id });
      return session;
    }
  } catch (err) {
    logger.error('Failed to read cookies', { error: err.message });
  }

  return null;
}

// --- Helpers ---

function deduplicateUsers(users) {
  const seen = new Set();
  return users.filter((u) => {
    if (seen.has(u.pk)) return false;
    seen.add(u.pk);
    return true;
  });
}

function crossReference(followers, following) {
  const followerPks = new Set(followers.map((u) => u.pk));
  const followingPks = new Set(following.map((u) => u.pk));

  const dontFollowMeBack = following.filter((u) => !followerPks.has(u.pk));
  const iDontFollowBack = followers.filter((u) => !followingPks.has(u.pk));
  const mutuals = following.filter((u) => followerPks.has(u.pk));

  return { dontFollowMeBack, iDontFollowBack, mutuals };
}

// --- Scan orchestration ---

async function runScan() {
  const state = defaultScanState();
  state.status = 'starting';
  state.startedAt = new Date().toISOString();
  await setScanState(state);

  try {
    // 1. Resolve session
    logger.info('=== Scan started ===');
    const session = await resolveSession();
    if (!session) {
      throw new Error(
        'Not logged into Instagram. Please open instagram.com and log in, then try again.'
      );
    }

    const api = new InstagramAPI(session.csrftoken, logger);
    currentApi = api;

    // 2. Fetch profile info
    state.status = 'fetching_profile';
    await setScanState(state);

    const profile = await api.fetchProfileInfo(session.ds_user_id);
    await setProfile(profile);

    state.followersProgress.total = profile.follower_count;
    state.followingProgress.total = profile.following_count;

    // 3. Fetch all followers
    state.status = 'fetching_followers';
    await setScanState(state);

    const followers = await api.fetchAllFollowers(
      session.ds_user_id,
      profile.follower_count,
      async (fetched, total, page) => {
        state.followersProgress.fetched = fetched;
        await setScanState(state);
      }
    );

    if (api.isAborted()) throw new Error('Scan aborted by user');

    // Brief pause between phases
    logger.info(`Pausing ${api.getPhaseDelay() / 1000}s before fetching following...`);
    await new Promise((r) => setTimeout(r, api.getPhaseDelay()));

    // 4. Fetch all following
    state.status = 'fetching_following';
    await setScanState(state);

    const following = await api.fetchAllFollowing(
      session.ds_user_id,
      profile.following_count,
      async (fetched, total, page) => {
        state.followingProgress.fetched = fetched;
        await setScanState(state);
      }
    );

    if (api.isAborted()) throw new Error('Scan aborted by user');

    // 5. Deduplicate (API can return dupes across pages)
    const dedupFollowers = deduplicateUsers(followers);
    const dedupFollowing = deduplicateUsers(following);
    logger.info('Deduplicated lists', {
      followers: `${followers.length} -> ${dedupFollowers.length}`,
      following: `${following.length} -> ${dedupFollowing.length}`,
    });

    // 6. Cross-reference
    state.status = 'cross_referencing';
    await setScanState(state);
    logger.info('Cross-referencing followers and following...');

    let { dontFollowMeBack, iDontFollowBack, mutuals } = crossReference(
      dedupFollowers,
      dedupFollowing
    );

    // 7. Verify "I don't follow back" using show_many endpoint
    //    This catches false positives from incomplete pagination
    if (iDontFollowBack.length > 0) {
      logger.info(`Verifying ${iDontFollowBack.length} "I don't follow back" users via show_many`);
      state.status = 'verifying';
      await setScanState(state);

      try {
        const pksToCheck = iDontFollowBack.map((u) => u.pk);
        const statuses = await api.verifyFollowStatus(pksToCheck);

        const falsePositives = [];
        iDontFollowBack = iDontFollowBack.filter((u) => {
          const status = statuses[u.pk];
          if (status && status.following === true) {
            falsePositives.push(u.username);
            mutuals.push(u); // they're actually mutual
            return false;
          }
          return true;
        });

        if (falsePositives.length > 0) {
          logger.warn(`Removed ${falsePositives.length} false positives from "I don't follow back"`, {
            users: falsePositives,
          });
        }
      } catch (err) {
        logger.warn('Verification via show_many failed, using unverified results', {
          error: err.message,
        });
      }
    }

    logger.info('Cross-reference complete', {
      dontFollowMeBack: dontFollowMeBack.length,
      iDontFollowBack: iDontFollowBack.length,
      mutuals: mutuals.length,
    });

    // 8. Compute "don't follow back AND not verified"
    const dontFollowMeBackUnverified = dontFollowMeBack.filter((u) => !u.is_verified);

    logger.info('Unverified non-followers', {
      total: dontFollowMeBackUnverified.length,
    });

    // 9. Compute diff against previous scan
    const previousResults = await getResults();
    let diff = null;

    if (previousResults && previousResults.followers && previousResults.following) {
      const prevFollowerPks = new Set(previousResults.followers.map((u) => u.pk));
      const prevFollowingPks = new Set(previousResults.following.map((u) => u.pk));
      const currFollowerPks = new Set(dedupFollowers.map((u) => u.pk));
      const currFollowingPks = new Set(dedupFollowing.map((u) => u.pk));

      // New followers (in current followers, not in previous)
      let newFollowers = dedupFollowers.filter((u) => !prevFollowerPks.has(u.pk));
      // Lost followers (in previous followers, not in current)
      let lostFollowers = previousResults.followers.filter((u) => !currFollowerPks.has(u.pk));
      // Newly following (I started following them)
      let newFollowing = dedupFollowing.filter((u) => !prevFollowingPks.has(u.pk));
      // Unfollowed by me (I stopped following them)
      let unfollowedByMe = previousResults.following.filter((u) => !currFollowingPks.has(u.pk));

      // Verify diff with show_many to eliminate false positives from pagination gaps
      const allDiffPks = [
        ...lostFollowers.map((u) => u.pk),
        ...unfollowedByMe.map((u) => u.pk),
        ...newFollowers.map((u) => u.pk),
        ...newFollowing.map((u) => u.pk),
      ];

      if (allDiffPks.length > 0) {
        logger.info(`Verifying ${allDiffPks.length} diff entries via show_many`);
        try {
          const statuses = await api.verifyFollowStatus(allDiffPks);

          // "Unfollowed by me" — remove if show_many says we still follow them
          const falseUnfollowed = [];
          unfollowedByMe = unfollowedByMe.filter((u) => {
            const s = statuses[u.pk];
            if (s && s.following === true) {
              falseUnfollowed.push(u.username);
              return false;
            }
            return true;
          });
          if (falseUnfollowed.length > 0) {
            logger.warn(`Removed ${falseUnfollowed.length} false "I unfollowed" entries`, {
              users: falseUnfollowed,
            });
          }

          // "Newly following" — remove if show_many says we don't follow them
          const falseNewFollowing = [];
          newFollowing = newFollowing.filter((u) => {
            const s = statuses[u.pk];
            if (s && s.following === false) {
              falseNewFollowing.push(u.username);
              return false;
            }
            return true;
          });
          if (falseNewFollowing.length > 0) {
            logger.warn(`Removed ${falseNewFollowing.length} false "newly following" entries`, {
              users: falseNewFollowing,
            });
          }

          // "Lost followers" — check if they actually still follow us
          // show_many tells us if WE follow THEM, not if they follow us.
          // We can't verify lost followers this way, so leave them as-is.
          // But we can filter out deactivated accounts that might just be missing from pagination.

        } catch (err) {
          logger.warn('Diff verification failed, using unverified diff', {
            error: err.message,
          });
        }
      }

      diff = {
        previousTimestamp: previousResults.timestamp,
        newFollowers,
        lostFollowers,
        newFollowing,
        unfollowedByMe,
      };

      logger.info('Diff computed against previous scan', {
        previousScan: previousResults.timestamp,
        newFollowers: newFollowers.length,
        lostFollowers: lostFollowers.length,
        newFollowing: newFollowing.length,
        unfollowedByMe: unfollowedByMe.length,
      });
    } else {
      logger.info('No previous scan found, skipping diff');
    }

    // 10. Save current as a history snapshot (lightweight — just PKs + usernames)
    await pushHistory({
      timestamp: new Date().toISOString(),
      followerCount: dedupFollowers.length,
      followingCount: dedupFollowing.length,
      dontFollowMeBackCount: dontFollowMeBack.length,
      mutualsCount: mutuals.length,
    });

    // 11. Store results
    const now = new Date().toISOString();
    await setResults({
      timestamp: now,
      followers: dedupFollowers,
      following: dedupFollowing,
      dontFollowMeBack,
      dontFollowMeBackUnverified,
      iDontFollowBack,
      mutuals,
      diff,
    });

    state.status = 'complete';
    state.completedAt = now;
    state.error = null;
    await setScanState(state);
    logger.info('=== Scan complete ===', {
      followers: dedupFollowers.length,
      following: dedupFollowing.length,
      dontFollowMeBack: dontFollowMeBack.length,
      iDontFollowBack: iDontFollowBack.length,
      mutuals: mutuals.length,
      hasDiff: !!diff,
    });
  } catch (err) {
    logger.error('Scan failed', { error: err.message, stack: err.stack });
    state.status = 'error';
    state.error = err.message;
    await setScanState(state);
  } finally {
    currentApi = null;
    await logger.persist();
  }
}

// --- Message handlers ---

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const { type } = message;

  if (type === 'SESSION_INFO') {
    setSession(message.payload).then(() => {
      logger.info('Session updated from content script', {
        userId: message.payload.ds_user_id,
      });
    });
    sendResponse({ ok: true });
    return false;
  }

  if (type === 'START_SCAN') {
    getScanState().then((s) => {
      if (s.status !== 'idle' && s.status !== 'complete' && s.status !== 'error') {
        sendResponse({ ok: false, error: 'Scan already in progress' });
        return;
      }
      sendResponse({ ok: true, status: 'started' });
      runScan();
    });
    return true; // async sendResponse
  }

  if (type === 'CANCEL_SCAN') {
    if (currentApi) {
      currentApi.abort();
      logger.warn('Scan cancelled by user');
    }
    setScanState({ ...defaultScanState(), status: 'idle', error: 'Cancelled by user' }).then(
      () => sendResponse({ ok: true })
    );
    return true;
  }

  if (type === 'GET_STATUS') {
    getScanState().then((state) => sendResponse(state));
    return true;
  }

  if (type === 'GET_RESULTS') {
    getResults().then((results) => sendResponse(results));
    return true;
  }

  if (type === 'GET_PROFILE') {
    getProfile().then((profile) => sendResponse(profile));
    return true;
  }

  if (type === 'GET_HISTORY') {
    getHistory().then((history) => sendResponse(history));
    return true;
  }

  if (type === 'GET_LOGS') {
    sendResponse({ logs: logger.getLogsAsText() });
    return false;
  }

  if (type === 'CLEAR_LOGS') {
    logger.clear();
    sendResponse({ ok: true });
    return false;
  }

  if (type === 'CLEAR_DATA') {
    Promise.all([
      setScanState(defaultScanState()),
      setResults(null),
    ]).then(() => {
      logger.info('Data cleared by user');
      sendResponse({ ok: true });
    });
    return true;
  }
});

// On install/startup, log it
chrome.runtime.onInstalled.addListener(() => {
  logger.info('Extension installed/updated');
});

chrome.runtime.onStartup.addListener(() => {
  logger.info('Extension started (browser startup)');
});
