<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import type { ConferenceTemplateSummary } from '@conference/contracts';
import { useRouter } from 'vue-router';
import { conferenceApi, session } from '../lib/api';
import { dateTime } from '../lib/format';

const router = useRouter();
const templates = ref<ConferenceTemplateSummary[]>([]);
const loading = ref(true);
const pending = ref(false);
const errorMessage = ref('');
const message = ref('');
const query = ref('');
const status = ref('');
const tag = ref('');
const archiveTarget = ref<ConferenceTemplateSummary>();
const canManage = computed(() => session.can('org.template.manage'));
const availableTags = computed(() => [...new Set(templates.value.flatMap((item) => item.tags))]);
const filteredTemplates = computed(() => {
  const normalized = query.value.trim().toLocaleLowerCase('zh-CN');
  return templates.value.filter((item) => {
    const matchesQuery =
      !normalized ||
      [item.name, item.description, item.code, ...item.tags].some((value) =>
        value.toLocaleLowerCase('zh-CN').includes(normalized),
      );
    return (
      matchesQuery &&
      (!status.value || item.status === status.value) &&
      (!tag.value || item.tags.includes(tag.value))
    );
  });
});
function statusLabel(value: ConferenceTemplateSummary['status']) {
  return { draft: '草稿', published: '已发布', archived: '已归档' }[value];
}

async function load() {
  loading.value = true;
  errorMessage.value = '';
  try {
    templates.value = await conferenceApi.getConferenceTemplates();
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '模板列表读取失败';
  } finally {
    loading.value = false;
  }
}

function edit(item: ConferenceTemplateSummary) {
  void router.push({
    name:
      item.presentationKind === 'html' ? 'manage-html-template-editor' : 'manage-template-editor',
    params: { templateId: item.id },
  });
}

async function duplicate(item: ConferenceTemplateSummary) {
  pending.value = true;
  errorMessage.value = '';
  try {
    const detail = await conferenceApi.getConferenceTemplate(item.id);
    await conferenceApi.duplicateConferenceTemplate(
      item.id,
      detail.draft.revision,
      `${item.name} 副本`,
    );
    message.value = `${item.name} 已复制为新草稿。`;
    await load();
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '复制模板失败';
  } finally {
    pending.value = false;
  }
}

async function confirmArchive() {
  const item = archiveTarget.value;
  if (!item) return;
  pending.value = true;
  errorMessage.value = '';
  try {
    const detail = await conferenceApi.getConferenceTemplate(item.id);
    await conferenceApi.setConferenceTemplateArchived(
      item.id,
      detail.draft.revision,
      item.rootStatus !== 'archived',
    );
    message.value =
      item.rootStatus === 'archived'
        ? `${item.name} 已恢复，可以继续编辑和选择。`
        : `${item.name} 已归档，现有大会绑定保持有效。`;
    archiveTarget.value = undefined;
    await load();
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '模板状态更新失败';
  } finally {
    pending.value = false;
  }
}

onMounted(load);
</script>

<template>
  <header class="admin-page-head reveal is-visible">
    <div>
      <p class="eyebrow">REUSABLE EXPERIENCES</p>
      <h1>模板管理</h1>
      <p>集中维护大会首页、FAQ、报名流程和初始化规则，一套模板可以服务多场大会。</p>
    </div>
    <button
      v-if="canManage"
      class="button"
      type="button"
      @click="router.push({ name: 'manage-template-create' })"
    >
      新建模板
    </button>
  </header>
  <p v-if="message" class="admin-success" role="status">{{ message }}</p>
  <p v-if="errorMessage" class="admin-error" role="alert">{{ errorMessage }}</p>

  <section class="admin-panel template-list-panel">
    <header class="admin-panel-header">
      <div>
        <h2>模板资料表</h2>
        <p>{{ filteredTemplates.length }} 套模板，包含使用量和升级提醒</p>
      </div>
    </header>
    <form class="admin-filter-bar template-filter-bar" role="search" @submit.prevent>
      <label class="admin-search">
        <span aria-hidden="true">⌕</span>
        <input v-model="query" type="search" aria-label="搜索模板" placeholder="搜索模板或标签" />
      </label>
      <label class="admin-select-label">
        <span>状态</span>
        <select v-model="status" class="admin-select">
          <option value="">全部状态</option>
          <option value="draft">草稿</option>
          <option value="published">已发布</option>
          <option value="archived">已归档</option>
        </select>
      </label>
      <label class="admin-select-label">
        <span>标签</span>
        <select v-model="tag" class="admin-select">
          <option value="">全部标签</option>
          <option v-for="item in availableTags" :key="item" :value="item">{{ item }}</option>
        </select>
      </label>
    </form>

    <div v-if="loading" class="admin-loading">正在读取模板资料…</div>
    <div v-else-if="filteredTemplates.length" class="template-data-table">
      <article v-for="item in filteredTemplates" :key="item.id" class="template-data-row">
        <div class="template-thumbnail" :data-renderer="item.rendererKey" aria-hidden="true">
          <span>TokEMS</span><i></i><i></i><i></i>
        </div>
        <div class="template-identity">
          <div>
            <strong>{{ item.name }}</strong>
            <span class="status-badge" :class="item.status">{{ statusLabel(item.status) }}</span>
            <span class="template-source-badge" :class="item.presentationKind">
              {{ item.presentationKind === 'html' ? 'HTML' : '结构化' }}
            </span>
          </div>
          <p>{{ item.description }}</p>
          <small>{{ item.tags.join(' / ') || '通用模板' }}</small>
        </div>
        <dl class="template-metrics">
          <div>
            <dt>当前版本</dt>
            <dd>{{ item.currentVersion ? `V${item.currentVersion}` : '未发布' }}</dd>
          </div>
          <div>
            <dt>使用大会</dt>
            <dd>{{ item.usageCount }}</dd>
          </div>
          <div>
            <dt>待升级</dt>
            <dd :class="{ warning: item.upgradeCount }">{{ item.upgradeCount }}</dd>
          </div>
          <div>
            <dt>渲染器</dt>
            <dd>{{ item.rendererName }} V{{ item.rendererVersion }}</dd>
          </div>
        </dl>
        <div class="template-row-meta">
          <span>{{ item.updatedByName ?? '系统' }}</span>
          <small>{{ dateTime(item.updatedAt) }}</small>
        </div>
        <div class="template-row-actions">
          <button class="button secondary compact" type="button" @click="edit(item)">
            {{ canManage ? '编辑草稿' : '查看模板' }}
          </button>
          <button
            v-if="canManage && item.currentPublishedVersionId"
            class="button secondary compact"
            type="button"
            :disabled="pending"
            @click="duplicate(item)"
          >
            复制
          </button>
          <button
            v-if="canManage"
            class="button secondary compact"
            :class="{ danger: item.rootStatus !== 'archived' }"
            type="button"
            :disabled="pending"
            @click="archiveTarget = item"
          >
            {{ item.rootStatus === 'archived' ? '恢复' : '归档' }}
          </button>
        </div>
      </article>
    </div>
    <div v-else class="admin-empty">
      {{ templates.length ? '当前筛选没有匹配模板。' : '当前组织还没有大会模板。' }}
    </div>
  </section>

  <section v-if="archiveTarget" class="admin-panel inline-confirm-panel" aria-live="polite">
    <div>
      <p class="eyebrow">CONFIRM ACTION</p>
      <h2>
        {{ archiveTarget.rootStatus === 'archived' ? '恢复模板' : '归档模板' }}“{{
          archiveTarget.name
        }}”
      </h2>
      <p v-if="archiveTarget.rootStatus !== 'archived'">
        现有 {{ archiveTarget.usageCount }} 场大会继续使用已绑定版本。归档后，新大会无法选择此模板。
      </p>
      <p v-else>恢复后，当前发布版本会重新出现在创建大会的模板选项中。</p>
    </div>
    <div class="row-actions">
      <button class="button secondary" type="button" @click="archiveTarget = undefined">
        取消
      </button>
      <button
        class="button"
        :class="{ danger: archiveTarget.rootStatus !== 'archived' }"
        type="button"
        :disabled="pending"
        @click="confirmArchive"
      >
        确认{{ archiveTarget.rootStatus === 'archived' ? '恢复' : '归档' }}
      </button>
    </div>
  </section>
</template>
