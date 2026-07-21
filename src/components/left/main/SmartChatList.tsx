import { memo, useMemo, useRef, useState } from '@teact';
import { withGlobal } from '../../../global';

import type { ApiChat, ApiUser } from '../../../api/types';
import type { GlobalState } from '../../../global/types';
import { MAIN_THREAD_ID } from '../../../api/types';

import { ALL_FOLDER_ID, ARCHIVED_FOLDER_ID, CHAT_LIST_SLICE } from '../../../config';
import { isUserBot } from '../../../global/helpers';
import { getIsChatMuted } from '../../../global/helpers/notifications';
import buildClassName from '../../../util/buildClassName';
import { isUserId } from '../../../util/entities/ids';
import { ChatAnimationTypes } from './hooks';

import { useFolderManagerForOrderedIds } from '../../../hooks/useFolderManager';
import useInfiniteScroll from '../../../hooks/useInfiniteScroll';
import { useIntersectionObserver } from '../../../hooks/useIntersectionObserver';
import useLang from '../../../hooks/useLang';
import useLastCallback from '../../../hooks/useLastCallback';

import InfiniteScroll from '../../ui/InfiniteScroll';
import SearchInput from '../../ui/SearchInput';
import Chat from './Chat';

import styles from './SmartChatList.module.scss';

type OwnProps = {
  isActive: boolean;
  isForumPanelOpen?: boolean;
  withTags?: boolean;
  isFoldersSidebarShown?: boolean;
  onScroll?: (e: React.UIEvent<HTMLDivElement>) => void;
};

type StateProps = {
  chatsById: GlobalState['chats']['byId'];
  usersById: GlobalState['users']['byId'];
  messagesByChatId: GlobalState['messages']['byChatId'];
  topicsInfoById: GlobalState['chats']['topicsInfoById'];
  lastMessageIds?: GlobalState['chats']['lastMessageIds']['all'];
  notifyDefaults: GlobalState['settings']['notifyDefaults'];
  notifyExceptionsById: GlobalState['chats']['notifyExceptionById'];
  activePinnedIds?: string[];
  archivedPinnedIds?: string[];
  areActiveChatsFullyLoaded: boolean;
  areArchivedChatsFullyLoaded: boolean;
};

type CategoryFilter = 'all' | 'people' | 'bots' | 'basicGroups' | 'supergroups' | 'channels';
type RoleFilter = 'all' | 'managed' | 'owner' | 'admin' | 'nonAdmin';
type LocationFilter = 'all' | 'active' | 'archived';
type ReadFilter = 'all' | 'unread' | 'read';
type MuteFilter = 'all' | 'muted' | 'unmuted';
type SortMode = 'recent' | 'name' | 'unread' | 'members';

const DEFAULT_CATEGORY_FILTER: CategoryFilter = 'channels';
const DEFAULT_ROLE_FILTER: RoleFilter = 'managed';

const SmartChatList = ({
  chatsById,
  usersById,
  messagesByChatId,
  topicsInfoById,
  lastMessageIds,
  notifyDefaults,
  notifyExceptionsById,
  activePinnedIds,
  archivedPinnedIds,
  areActiveChatsFullyLoaded,
  areArchivedChatsFullyLoaded,
  isActive,
  isForumPanelOpen,
  withTags,
  isFoldersSidebarShown,
  onScroll,
}: OwnProps & StateProps) => {
  const containerRef = useRef<HTMLDivElement>();
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>(DEFAULT_CATEGORY_FILTER);
  const [roleFilter, setRoleFilter] = useState<RoleFilter>(DEFAULT_ROLE_FILTER);
  const [locationFilter, setLocationFilter] = useState<LocationFilter>('all');
  const [readFilter, setReadFilter] = useState<ReadFilter>('all');
  const [muteFilter, setMuteFilter] = useState<MuteFilter>('all');
  const [sortMode, setSortMode] = useState<SortMode>('recent');
  const filteredChatIdsRef = useRef<string[]>([]);

  const lang = useLang();
  const activeChatIds = useFolderManagerForOrderedIds(ALL_FOLDER_ID);
  const archivedChatIds = useFolderManagerForOrderedIds(ARCHIVED_FOLDER_ID);

  const sourceChatIds = useMemo(() => {
    if (locationFilter === 'active') return activeChatIds || [];
    if (locationFilter === 'archived') return archivedChatIds || [];

    return [...new Set([...(activeChatIds || []), ...(archivedChatIds || [])])];
  }, [activeChatIds, archivedChatIds, locationFilter]);

  const filteredChatIds = useMemo(() => {
    if (!isActive) return filteredChatIdsRef.current;

    const normalizedSearchQuery = searchQuery.trim().toLocaleLowerCase();
    const recentOrderById = new Map(sourceChatIds.map((chatId, index) => [chatId, index]));
    const unreadCountsById = new Map<string, number>();

    const chatIds = sourceChatIds.filter((chatId) => {
      const chat = chatsById[chatId];
      if (!chat) return false;

      const user = usersById[chatId];
      if (!checkChatCategory(chat, user, categoryFilter)) return false;
      if (!checkChatRole(chat, roleFilter)) return false;
      if (!checkChatSearch(chat, user, normalizedSearchQuery)) return false;

      const unreadCount = getChatUnreadCount(chat, messagesByChatId, topicsInfoById);
      unreadCountsById.set(chatId, unreadCount);
      if (!checkChatReadState(unreadCount, readFilter)) return false;

      const isMuted = getIsChatMuted(chat, notifyDefaults, notifyExceptionsById[chatId]);
      return checkChatMuteState(isMuted, muteFilter);
    });

    sortChatIds(
      chatIds,
      sortMode,
      chatsById,
      messagesByChatId,
      lastMessageIds,
      unreadCountsById,
      recentOrderById,
      lang.code,
    );

    filteredChatIdsRef.current = chatIds;
    return chatIds;
  }, [
    categoryFilter, chatsById, isActive, lang.code, lastMessageIds, messagesByChatId, muteFilter, notifyDefaults,
    notifyExceptionsById, readFilter, roleFilter, searchQuery, sortMode, sourceChatIds, topicsInfoById, usersById,
  ]);

  const [viewportIds, getMore] = useInfiniteScroll(undefined, filteredChatIds, undefined, CHAT_LIST_SLICE);
  const { observe } = useIntersectionObserver({ rootRef: containerRef });

  const pinnedChatIds = useMemo(
    () => new Set([...(activePinnedIds || []), ...(archivedPinnedIds || [])]),
    [activePinnedIds, archivedPinnedIds],
  );
  const areAllChatsLoaded = areActiveChatsFullyLoaded && areArchivedChatsFullyLoaded;

  const handleSearchReset = useLastCallback(() => {
    setSearchQuery('');
  });

  const handleCategoryChange = useLastCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    const category = e.currentTarget.value as CategoryFilter;
    setCategoryFilter(category);

    if (category === 'people' || category === 'bots') {
      setRoleFilter('all');
    }
  });

  const handleRoleChange = useLastCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    setRoleFilter(e.currentTarget.value as RoleFilter);
  });

  const handleLocationChange = useLastCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    setLocationFilter(e.currentTarget.value as LocationFilter);
  });

  const handleReadChange = useLastCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    setReadFilter(e.currentTarget.value as ReadFilter);
  });

  const handleMuteChange = useLastCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    setMuteFilter(e.currentTarget.value as MuteFilter);
  });

  const handleSortChange = useLastCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    setSortMode(e.currentTarget.value as SortMode);
  });

  function renderControls() {
    return (
      <div key="controls" className={styles.controls}>
        <SearchInput
          className={styles.search}
          value={searchQuery}
          placeholder={lang('Search')}
          onChange={setSearchQuery}
          onReset={handleSearchReset}
        />
        <div className={styles.filters}>
          <label className={styles.field}>
            <span className={styles.label}>{lang('SmartFilterChatType')}</span>
            <select
              className={styles.select}
              value={categoryFilter}
              aria-label={lang('SmartFilterChatType')}
              onChange={handleCategoryChange}
            >
              <option value="all">{lang('SmartFilterAllTypes')}</option>
              <option value="people">{lang('SmartFilterPeople')}</option>
              <option value="bots">{lang('FilterBots')}</option>
              <option value="basicGroups">{lang('SmartFilterBasicGroups')}</option>
              <option value="supergroups">{lang('SmartFilterSupergroups')}</option>
              <option value="channels">{lang('FilterChannels')}</option>
            </select>
          </label>
          <label className={styles.field}>
            <span className={styles.label}>{lang('SmartFilterRole')}</span>
            <select
              className={styles.select}
              value={roleFilter}
              disabled={categoryFilter === 'people' || categoryFilter === 'bots'}
              aria-label={lang('SmartFilterRole')}
              onChange={handleRoleChange}
            >
              <option value="all">{lang('SmartFilterAllRoles')}</option>
              <option value="managed">{lang('SmartFilterManaged')}</option>
              <option value="owner">{lang('ChannelCreator')}</option>
              <option value="admin">{lang('ChannelAdmin')}</option>
              <option value="nonAdmin">{lang('SmartFilterNonAdmin')}</option>
            </select>
          </label>
          <label className={styles.field}>
            <span className={styles.label}>{lang('SmartFilterLocation')}</span>
            <select
              className={styles.select}
              value={locationFilter}
              aria-label={lang('SmartFilterLocation')}
              onChange={handleLocationChange}
            >
              <option value="all">{lang('SmartFilterAllLocations')}</option>
              <option value="active">{lang('SmartFilterActive')}</option>
              <option value="archived">{lang('FilterArchived')}</option>
            </select>
          </label>
          <label className={styles.field}>
            <span className={styles.label}>{lang('SmartFilterReadState')}</span>
            <select
              className={styles.select}
              value={readFilter}
              aria-label={lang('SmartFilterReadState')}
              onChange={handleReadChange}
            >
              <option value="all">{lang('SmartFilterAnyReadState')}</option>
              <option value="unread">{lang('SmartFilterUnread')}</option>
              <option value="read">{lang('SmartFilterRead')}</option>
            </select>
          </label>
          <label className={styles.field}>
            <span className={styles.label}>{lang('SmartFilterNotifications')}</span>
            <select
              className={styles.select}
              value={muteFilter}
              aria-label={lang('SmartFilterNotifications')}
              onChange={handleMuteChange}
            >
              <option value="all">{lang('SmartFilterAnyNotification')}</option>
              <option value="muted">{lang('SmartFilterMuted')}</option>
              <option value="unmuted">{lang('SmartFilterUnmuted')}</option>
            </select>
          </label>
          <label className={styles.field}>
            <span className={styles.label}>{lang('SmartFilterSort')}</span>
            <select
              className={styles.select}
              value={sortMode}
              aria-label={lang('SmartFilterSort')}
              onChange={handleSortChange}
            >
              <option value="recent">{lang('SmartFilterSortRecent')}</option>
              <option value="name">{lang('SmartFilterSortName')}</option>
              <option value="unread">{lang('SmartFilterSortUnread')}</option>
              <option value="members">{lang('SmartFilterSortMembers')}</option>
            </select>
          </label>
        </div>
        <div className={styles.summary}>
          <span className={styles.resultCount}>
            {lang('SmartFilterResults', { count: filteredChatIds.length }, { pluralValue: filteredChatIds.length })}
          </span>
          {!areAllChatsLoaded && <span className={styles.loading}>{lang('SmartFilterLoading')}</span>}
        </div>
      </div>
    );
  }

  return (
    <InfiniteScroll
      ref={containerRef}
      className={buildClassName(
        'chat-list custom-scroll',
        styles.root,
        isForumPanelOpen && 'forum-panel-open',
      )}
      items={viewportIds}
      itemSelector=".Chat"
      preloadBackwards={CHAT_LIST_SLICE}
      beforeChildren={renderControls()}
      onLoadMore={getMore}
      onScroll={onScroll}
    >
      {viewportIds?.length ? viewportIds.map((chatId, index) => (
        <Chat
          key={chatId}
          teactOrderKey={index}
          chatId={chatId}
          orderDiff={0}
          shiftDiff={0}
          animationType={ChatAnimationTypes.None}
          isPinned={pinnedChatIds.has(chatId)}
          className={styles.chat}
          observeIntersection={observe}
          withTags={withTags}
          isFoldersSidebarShown={isFoldersSidebarShown}
        />
      )) : (
        <div key="empty" className={styles.empty}>
          {lang(areAllChatsLoaded ? 'SmartFilterNoResults' : 'SmartFilterLoading')}
        </div>
      )}
    </InfiniteScroll>
  );
};

function checkChatCategory(chat: ApiChat, user: ApiUser | undefined, categoryFilter: CategoryFilter) {
  if (categoryFilter === 'all') return true;
  if (categoryFilter === 'people') return Boolean(user && !user.isSelf && !isUserBot(user));
  if (categoryFilter === 'bots') return Boolean(user && isUserBot(user));
  if (categoryFilter === 'basicGroups') return chat.type === 'chatTypeBasicGroup';
  if (categoryFilter === 'supergroups') return chat.type === 'chatTypeSuperGroup';

  return chat.type === 'chatTypeChannel';
}

function checkChatRole(chat: ApiChat, roleFilter: RoleFilter) {
  if (roleFilter === 'all') return true;
  if (isUserId(chat.id)) return false;

  const isOwner = Boolean(chat.isCreator);
  const isAdmin = Boolean(chat.adminRights);
  if (roleFilter === 'managed') return isOwner || isAdmin;
  if (roleFilter === 'owner') return isOwner;
  if (roleFilter === 'admin') return !isOwner && isAdmin;

  return !isOwner && !isAdmin;
}

function checkChatSearch(chat: ApiChat, user: ApiUser | undefined, normalizedSearchQuery: string) {
  if (!normalizedSearchQuery) return true;

  const searchableValues = [
    chat.title,
    user?.firstName,
    user?.lastName,
    ...(chat.usernames?.map(({ username }) => username) || []),
    ...(user?.usernames?.map(({ username }) => username) || []),
  ];

  return searchableValues.some((value) => value?.toLocaleLowerCase().includes(normalizedSearchQuery));
}

function checkChatReadState(unreadCount: number, readFilter: ReadFilter) {
  if (readFilter === 'unread') return unreadCount > 0;
  if (readFilter === 'read') return unreadCount === 0;

  return true;
}

function checkChatMuteState(isMuted: boolean, muteFilter: MuteFilter) {
  if (muteFilter === 'muted') return isMuted;
  if (muteFilter === 'unmuted') return !isMuted;

  return true;
}

function getChatUnreadCount(
  chat: ApiChat,
  messagesByChatId: GlobalState['messages']['byChatId'],
  topicsInfoById: GlobalState['chats']['topicsInfoById'],
) {
  const threadsById = messagesByChatId[chat.id]?.threadsById;
  const mainReadState = threadsById?.[MAIN_THREAD_ID]?.readState;
  if (!chat.isForum) {
    return mainReadState?.unreadCount || (mainReadState?.hasUnreadMark ? 1 : 0);
  }

  const listedTopicIds = topicsInfoById[chat.id]?.listedTopicIds;
  if (!listedTopicIds?.length) {
    return mainReadState?.unreadCount || (mainReadState?.hasUnreadMark ? 1 : 0);
  }

  return listedTopicIds.reduce((total, topicId) => {
    const readState = threadsById?.[topicId]?.readState;
    return total + (readState?.unreadCount || (readState?.hasUnreadMark ? 1 : 0));
  }, 0);
}

function sortChatIds(
  chatIds: string[],
  sortMode: SortMode,
  chatsById: GlobalState['chats']['byId'],
  messagesByChatId: GlobalState['messages']['byChatId'],
  lastMessageIds: GlobalState['chats']['lastMessageIds']['all'],
  unreadCountsById: Map<string, number>,
  recentOrderById: Map<string, number>,
  languageCode: string,
) {
  chatIds.sort((firstChatId, secondChatId) => {
    const firstChat = chatsById[firstChatId];
    const secondChat = chatsById[secondChatId];

    if (sortMode === 'name') {
      return firstChat.title.localeCompare(secondChat.title, languageCode);
    }
    if (sortMode === 'unread') {
      const unreadDifference = (unreadCountsById.get(secondChatId) || 0)
        - (unreadCountsById.get(firstChatId) || 0);
      if (unreadDifference) return unreadDifference;
    }

    if (sortMode === 'members') {
      const membersDifference = (secondChat.membersCount || 0) - (firstChat.membersCount || 0);
      if (membersDifference) return membersDifference;
    }

    const firstMessageDate = getLastMessageDate(firstChatId, messagesByChatId, lastMessageIds);
    const secondMessageDate = getLastMessageDate(secondChatId, messagesByChatId, lastMessageIds);
    const messageDateDifference = secondMessageDate - firstMessageDate;
    if (messageDateDifference) return messageDateDifference;

    return (recentOrderById.get(firstChatId) || 0) - (recentOrderById.get(secondChatId) || 0);
  });
}

function getLastMessageDate(
  chatId: string,
  messagesByChatId: GlobalState['messages']['byChatId'],
  lastMessageIds?: GlobalState['chats']['lastMessageIds']['all'],
) {
  const lastMessageId = lastMessageIds?.[chatId];
  return lastMessageId ? messagesByChatId[chatId]?.byId[lastMessageId]?.date || 0 : 0;
}

export default memo(withGlobal<OwnProps>((global): Complete<StateProps> => {
  return {
    chatsById: global.chats.byId,
    usersById: global.users.byId,
    messagesByChatId: global.messages.byChatId,
    topicsInfoById: global.chats.topicsInfoById,
    lastMessageIds: global.chats.lastMessageIds.all,
    notifyDefaults: global.settings.notifyDefaults,
    notifyExceptionsById: global.chats.notifyExceptionById,
    activePinnedIds: global.chats.orderedPinnedIds.active,
    archivedPinnedIds: global.chats.orderedPinnedIds.archived,
    areActiveChatsFullyLoaded: Boolean(global.chats.isFullyLoaded.active),
    areArchivedChatsFullyLoaded: Boolean(global.chats.isFullyLoaded.archived),
  };
})(SmartChatList));
