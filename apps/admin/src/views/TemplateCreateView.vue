<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import type {
  ConferenceTemplateSummary,
  HtmlTemplateBindingManifest,
  HtmlTemplateBindingProposal,
} from '@conference/contracts';
import { conferenceApi, session, type HtmlTemplateImport } from '../lib/api';

const router = useRouter();
const route = useRoute();
const replaceTemplateId = computed(() => String(route.query.replace ?? ''));
const replacing = computed(() => Boolean(replaceTemplateId.value));
const step = ref(1);
const creationSteps = [
  { number: 1, label: '选择来源' },
  { number: 2, label: '上传与扫描' },
  { number: 3, label: '确认变量' },
  { number: 4, label: '创建完成' },
] as const;
const source = ref<'html' | 'structured'>('html');
const templates = ref<ConferenceTemplateSummary[]>([]);
const recentImports = ref<HtmlTemplateImport[]>([]);
const file = ref<File>();
const dragging = ref(false);
const pending = ref(false);
const errorMessage = ref('');
const progressMessage = ref('');
const importResult = ref<HtmlTemplateImport>();
const selectedProposalIds = ref<string[]>([]);
const confirmWarnings = ref(false);
const createdTemplateId = ref('');
const replaceRevision = ref<number>();
const form = ref({
  name: '',
  description: '',
  tags: '',
  sourceUrl: '',
  sourceTemplateVersionId: '',
});
let disposed = false;

const canPublish = computed(() => session.can('org.template.publish'));
const tags = computed(() =>
  form.value.tags
    .split(/、|,|，/u)
    .map((item) => item.trim())
    .filter(Boolean),
);
const report = computed(() => importResult.value?.securityReport ?? {});
const blockers = computed(() => report.value.blockers ?? []);
const warnings = computed(() => report.value.warnings ?? []);
const removedCount = computed(
  () => (report.value.removedTags?.length ?? 0) + (report.value.removedAttributes?.length ?? 0),
);
const suggestions = computed(() => importResult.value?.suggestions ?? []);
const resumableImports = computed(() =>
  recentImports.value
    .filter((item) =>
      ['awaiting_upload', 'queued', 'scanning', 'needs_review', 'ready', 'failed'].includes(
        item.status,
      ),
    )
    .slice(0, 4),
);
const selectedSuggestions = computed(() =>
  suggestions.value.filter((proposal) => selectedProposalIds.value.includes(proposal.proposalId)),
);
const canCommit = computed(
  () =>
    Boolean(importResult.value) &&
    blockers.value.length === 0 &&
    (importResult.value?.status !== 'needs_review' || confirmWarnings.value),
);

function proposalVariable(proposal: HtmlTemplateBindingProposal) {
  if (proposal.binding.kind === 'text') {
    return proposal.binding.segments
      .filter((segment) => segment.kind === 'variable')
      .map((segment) => (segment.kind === 'variable' ? segment.path : ''))
      .filter(Boolean)
      .join(' + ');
  }
  if (proposal.binding.kind === 'attribute') return proposal.binding.variablePath;
  if (proposal.binding.kind === 'conditional') return proposal.binding.variablePath;
  return proposal.binding.collectionPath;
}

function chooseFile(value?: File) {
  errorMessage.value = '';
  if (!value) return;
  if (!/\.html?$/iu.test(value.name)) {
    errorMessage.value = '请选择 .html 或 .htm 文件。';
    return;
  }
  if (value.size > 5 * 1024 * 1024) {
    errorMessage.value = 'HTML 文件不能超过 5 MiB。';
    return;
  }
  file.value = value;
}

function onDrop(event: DragEvent) {
  dragging.value = false;
  chooseFile(event.dataTransfer?.files[0]);
}

function importStatusLabel(status: HtmlTemplateImport['status']) {
  return {
    awaiting_upload: '等待上传',
    queued: '等待扫描',
    scanning: '扫描中',
    needs_review: '待确认',
    ready: '可创建',
    committed: '已创建',
    failed: '处理失败',
    expired: '已过期',
  }[status];
}

function useImportResult(result: HtmlTemplateImport) {
  progressMessage.value = '';
  importResult.value = result;
  const metadata = result.requestedMetadata;
  if (!form.value.name && typeof metadata.name === 'string') form.value.name = metadata.name;
  if (!form.value.description && typeof metadata.description === 'string') {
    form.value.description = metadata.description;
  }
  if (!form.value.tags && Array.isArray(metadata.tags)) {
    form.value.tags = metadata.tags
      .filter((item): item is string => typeof item === 'string')
      .join('、');
  }
  selectedProposalIds.value = result.suggestions
    .filter((proposal) => proposal.confidence >= 0.95)
    .map((proposal) => proposal.proposalId);
  confirmWarnings.value = result.status === 'ready';
  step.value = 3;
}

function wait(delay: number) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, delay));
}

async function waitForImport(initial: HtmlTemplateImport) {
  let current = initial;
  for (let attempt = 0; attempt < 150 && !disposed; attempt += 1) {
    if (['ready', 'needs_review'].includes(current.status)) return current;
    if (current.status === 'failed') {
      throw new Error(current.errorMessage || 'HTML 扫描失败，请修复文件后重试');
    }
    if (current.status === 'expired') throw new Error('HTML 导入任务已经过期，请重新上传');
    progressMessage.value =
      current.status === 'scanning'
        ? '正在安全扫描页面、内化图片并识别可绑定节点…'
        : '文件已上传，正在等待扫描任务…';
    await wait(attempt < 5 ? 800 : 1_500);
    if (disposed) break;
    current = await conferenceApi.getHtmlTemplateImport(current.id);
  }
  throw new Error('扫描仍在后台继续，你可以稍后从“最近的 HTML 导入”恢复');
}

async function resumeImport(item: HtmlTemplateImport) {
  pending.value = true;
  errorMessage.value = '';
  progressMessage.value = '';
  try {
    const started = ['awaiting_upload', 'failed'].includes(item.status)
      ? await conferenceApi.retryHtmlTemplateImport(item.id)
      : await conferenceApi.getHtmlTemplateImport(item.id);
    const result = await waitForImport(started);
    useImportResult(result);
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '导入任务恢复失败';
    recentImports.value = await conferenceApi
      .getHtmlTemplateImports()
      .catch(() => recentImports.value);
  } finally {
    pending.value = false;
    progressMessage.value = '';
  }
}

async function cancelImport(item: HtmlTemplateImport) {
  pending.value = true;
  errorMessage.value = '';
  progressMessage.value = '';
  try {
    await conferenceApi.cancelHtmlTemplateImport(item.id);
    recentImports.value = recentImports.value.filter((candidate) => candidate.id !== item.id);
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '导入任务取消失败';
  } finally {
    pending.value = false;
  }
}

async function enterDetails() {
  errorMessage.value = '';
  if (source.value === 'structured' && templates.value.length === 0) {
    try {
      templates.value = await conferenceApi.getConferenceTemplates();
    } catch (error) {
      errorMessage.value = error instanceof Error ? error.message : '模板来源读取失败';
      return;
    }
  }
  step.value = 2;
}

async function uploadAndScan() {
  if (!file.value) {
    errorMessage.value = '请先选择 HTML 文件。';
    return;
  }
  if (!form.value.name.trim() || !form.value.description.trim()) {
    errorMessage.value = '请填写模板名称和适用场景。';
    return;
  }
  pending.value = true;
  errorMessage.value = '';
  progressMessage.value = '正在上传 HTML 文件…';
  try {
    const started = await conferenceApi.uploadAndScanHtmlTemplate(file.value, {
      mode: replacing.value ? 'replace' : 'create',
      ...(replacing.value ? { templateId: replaceTemplateId.value } : {}),
      name: form.value.name.trim(),
      description: form.value.description.trim(),
      tags: tags.value,
      ...(form.value.sourceUrl.trim() ? { sourceUrl: form.value.sourceUrl.trim() } : {}),
    });
    const result = await waitForImport(started);
    useImportResult(result);
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : 'HTML 上传或扫描失败';
  } finally {
    pending.value = false;
    progressMessage.value = '';
  }
}

async function createStructuredTemplate() {
  if (!form.value.name.trim() || !form.value.description.trim()) {
    errorMessage.value = '请填写模板名称和适用场景。';
    return;
  }
  pending.value = true;
  errorMessage.value = '';
  try {
    const created = await conferenceApi.createConferenceTemplate({
      name: form.value.name.trim(),
      description: form.value.description.trim(),
      tags: tags.value,
      ...(form.value.sourceTemplateVersionId
        ? { sourceTemplateVersionId: form.value.sourceTemplateVersionId }
        : {}),
      publishImmediately: false,
    });
    createdTemplateId.value = created.summary.id;
    step.value = 4;
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '模板创建失败';
  } finally {
    pending.value = false;
  }
}

async function commitHtmlTemplate() {
  if (!importResult.value || !canCommit.value) return;
  pending.value = true;
  errorMessage.value = '';
  try {
    const manifest: HtmlTemplateBindingManifest = {
      version: 1,
      bindings: selectedSuggestions.value.map((proposal) => proposal.binding),
    };
    const created = await conferenceApi.commitHtmlTemplateImport(importResult.value.id, {
      ...(replaceRevision.value === undefined ? {} : { revision: replaceRevision.value }),
      bindings: manifest,
      confirmWarnings: confirmWarnings.value,
      name: form.value.name.trim(),
      description: form.value.description.trim(),
      tags: tags.value,
    });
    createdTemplateId.value = created.templateId;
    step.value = 4;
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : 'HTML 模板创建失败';
  } finally {
    pending.value = false;
  }
}

function openEditor() {
  void router.push({
    name: source.value === 'html' ? 'manage-html-template-editor' : 'manage-template-editor',
    params: { templateId: createdTemplateId.value },
  });
}

onMounted(async () => {
  try {
    recentImports.value = await conferenceApi.getHtmlTemplateImports();
  } catch {
    recentImports.value = [];
  }
  if (!replacing.value) return;
  source.value = 'html';
  step.value = 2;
  try {
    const detail = await conferenceApi.getConferenceTemplate(replaceTemplateId.value);
    form.value.name = detail.summary.name;
    form.value.description = detail.summary.description;
    form.value.tags = detail.summary.tags.join('、');
    replaceRevision.value = detail.draft.revision;
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '目标模板读取失败';
  }
});

onBeforeUnmount(() => {
  disposed = true;
});
</script>

<template>
  <header class="admin-page-head template-create-head reveal is-visible">
    <div>
      <button
        class="text-back-link"
        type="button"
        @click="router.push({ name: 'manage-templates' })"
      >
        ← 返回模板管理
      </button>
      <p class="eyebrow">CREATE TEMPLATE</p>
      <h1>{{ replacing ? '替换 HTML 源文件' : '新建大会模板' }}</h1>
      <p>
        {{
          replacing
            ? '新文件通过扫描后会成为当前草稿的新文档，已发布版本保持稳定。'
            : '导入一个 HTML 文件，系统会完成安全扫描、节点识别和动态变量建议。'
        }}
      </p>
    </div>
  </header>

  <ol v-if="!replacing" class="template-create-steps" aria-label="新建模板进度">
    <li
      v-for="item in creationSteps"
      :key="item.number"
      :class="{ active: step === item.number, complete: step > item.number }"
    >
      <span>{{ item.number }}</span>
      <b>{{ item.label }}</b>
    </li>
  </ol>

  <p v-if="errorMessage" class="admin-error" role="alert">{{ errorMessage }}</p>
  <p v-if="progressMessage" class="template-scan-progress" role="status">
    <span aria-hidden="true"></span>{{ progressMessage }}
  </p>

  <main class="admin-panel template-create-workspace">
    <section v-if="step === 1" class="template-source-step">
      <header>
        <p class="eyebrow">SOURCE</p>
        <h2>你准备从哪里开始</h2>
        <p>两种来源共用版本、发布和大会绑定能力。</p>
      </header>
      <div class="template-source-options">
        <button
          type="button"
          class="template-source-option"
          :class="{ selected: source === 'html' }"
          @click="source = 'html'"
        >
          <span class="source-code-mark" aria-hidden="true">&lt;/&gt;</span>
          <strong>导入 HTML</strong>
          <p>保留现有视觉和响应式布局，系统自动清理风险内容并推荐大会变量。</p>
          <small>推荐给已有设计稿或 AI 生成网页的团队</small>
        </button>
        <button
          type="button"
          class="template-source-option"
          :class="{ selected: source === 'structured' }"
          @click="source = 'structured'"
        >
          <span class="source-structure-mark" aria-hidden="true">▦</span>
          <strong>结构化模板</strong>
          <p>使用现有首页区块、FAQ 和报名流程，从基础模板或已发布版本开始。</p>
          <small>适合持续由运营团队维护的标准大会</small>
        </button>
      </div>
      <section v-if="resumableImports.length" class="recent-imports-panel">
        <header>
          <div>
            <strong>继续最近的 HTML 导入</strong>
            <small>未完成任务会保留 24 小时</small>
          </div>
          <span>{{ resumableImports.length }} 个</span>
        </header>
        <div>
          <article v-for="item in resumableImports" :key="item.id">
            <span class="source-code-mark" aria-hidden="true">HTML</span>
            <div>
              <strong>{{ item.originalFilename }}</strong>
              <small>
                {{ importStatusLabel(item.status) }} ·
                {{ new Date(item.updatedAt).toLocaleString('zh-CN') }}
              </small>
            </div>
            <button
              class="button secondary compact"
              type="button"
              :disabled="pending"
              @click="resumeImport(item)"
            >
              {{ item.status === 'failed' ? '重试' : '继续' }}
            </button>
            <button
              class="text-button danger"
              type="button"
              :disabled="pending"
              @click="cancelImport(item)"
            >
              取消
            </button>
          </article>
        </div>
      </section>
      <footer class="template-create-actions">
        <span>已选择：{{ source === 'html' ? '导入 HTML' : '结构化模板' }}</span>
        <button class="button" type="button" @click="enterDetails">继续</button>
      </footer>
    </section>

    <section v-else-if="step === 2" class="template-upload-step">
      <header>
        <p class="eyebrow">{{ source === 'html' ? 'UPLOAD' : 'DETAILS' }}</p>
        <h2>{{ source === 'html' ? '上传并识别页面' : '设置模板资料' }}</h2>
        <p>
          {{
            source === 'html'
              ? '文件会先进入私有临时区，扫描确认后才创建模板。'
              : '模板创建后进入草稿，不会自动影响任何大会。'
          }}
        </p>
      </header>
      <form
        class="template-create-form"
        @submit.prevent="source === 'html' ? uploadAndScan() : createStructuredTemplate()"
      >
        <div class="form-grid">
          <div class="form-field">
            <label for="new-template-name">模板名称</label>
            <input
              id="new-template-name"
              v-model="form.name"
              required
              minlength="2"
              maxlength="160"
              placeholder="例：2026 品牌增长大会"
            />
          </div>
          <div class="form-field">
            <label for="new-template-tags">标签</label>
            <input id="new-template-tags" v-model="form.tags" placeholder="行业峰会、品牌大会" />
          </div>
          <div class="form-field full">
            <label for="new-template-description">适用场景</label>
            <textarea
              id="new-template-description"
              v-model="form.description"
              required
              rows="3"
              maxlength="2000"
              placeholder="说明这套模板适合哪些大会和内容结构"
            />
          </div>
          <div v-if="source === 'html'" class="form-field full">
            <label for="new-template-source-url">原页面地址（可选）</label>
            <input
              id="new-template-source-url"
              v-model="form.sourceUrl"
              type="url"
              inputmode="url"
              placeholder="https://example.com/event/index.html"
            />
            <small>填写后，系统可以安全下载并内化 HTML 中的相对图片和字体资源。</small>
          </div>
          <div v-if="source === 'structured'" class="form-field full">
            <label for="new-template-source">复制来源</label>
            <select id="new-template-source" v-model="form.sourceTemplateVersionId">
              <option value="">系统基础模板</option>
              <option
                v-for="item in templates.filter((entry) => entry.currentPublishedVersionId)"
                :key="item.id"
                :value="item.currentPublishedVersionId ?? ''"
              >
                {{ item.name }} · V{{ item.currentVersion }}
              </option>
            </select>
          </div>
        </div>

        <label
          v-if="source === 'html'"
          class="html-drop-zone"
          :class="{ dragging, ready: file }"
          @dragenter.prevent="dragging = true"
          @dragover.prevent
          @dragleave.prevent="dragging = false"
          @drop.prevent="onDrop"
        >
          <input
            type="file"
            accept=".html,.htm,text/html"
            @change="chooseFile(($event.target as HTMLInputElement).files?.[0])"
          />
          <span class="drop-zone-mark" aria-hidden="true">HTML</span>
          <strong>{{ file ? file.name : '拖入 HTML 文件，或点击选择' }}</strong>
          <small v-if="file">{{ (file.size / 1024).toFixed(1) }} KiB · 上传后自动开始安全扫描</small>
          <small v-else>UTF-8，最大 5 MiB，支持内联 CSS</small>
        </label>

        <footer class="template-create-actions">
          <button class="button secondary" type="button" @click="step = 1">上一步</button>
          <button class="button" type="submit" :disabled="pending || (source === 'html' && !file)">
            {{ pending ? '正在处理…' : source === 'html' ? '上传并扫描' : '创建草稿' }}
          </button>
        </footer>
      </form>
    </section>

    <section v-else-if="step === 3 && importResult" class="template-review-step">
      <header class="template-review-head">
        <div>
          <p class="eyebrow">SCAN RESULT</p>
          <h2>扫描完成，确认动态变量</h2>
          <p>
            {{ importResult.originalFilename }} · 识别到
            {{ importResult.nodeManifest.length }} 个页面节点
          </p>
        </div>
        <span class="scan-status" :class="blockers.length ? 'blocked' : 'ready'">
          {{ blockers.length ? `${blockers.length} 个阻塞项` : '可以创建模板' }}
        </span>
      </header>

      <div class="template-review-grid">
        <aside class="scan-report-panel">
          <h3>安全扫描</h3>
          <dl class="scan-metrics">
            <div>
              <dt>自动清理</dt>
              <dd>{{ removedCount }}</dd>
            </div>
            <div>
              <dt>提醒</dt>
              <dd>{{ warnings.length }}</dd>
            </div>
            <div>
              <dt>阻塞</dt>
              <dd :class="{ danger: blockers.length }">{{ blockers.length }}</dd>
            </div>
          </dl>
          <div v-if="blockers.length" class="scan-message-list danger">
            <strong>需要处理</strong>
            <p v-for="item in blockers" :key="item">{{ item }}</p>
          </div>
          <div v-if="warnings.length" class="scan-message-list warning">
            <strong>上线前提醒</strong>
            <p v-for="item in warnings" :key="item">{{ item }}</p>
          </div>
          <div
            v-if="report.removedTags?.length || report.removedAttributes?.length"
            class="scan-message-list"
          >
            <strong>已经安全移除</strong>
            <p>
              {{ [...(report.removedTags ?? []), ...(report.removedAttributes ?? [])].join('、') }}
            </p>
          </div>
        </aside>

        <section class="mapping-review-panel">
          <header>
            <div>
              <h3>智能变量建议</h3>
              <p>高置信度建议已预选，创建后仍可在编辑器中调整。</p>
            </div>
            <span>{{ selectedProposalIds.length }} / {{ suggestions.length }} 已选择</span>
          </header>
          <div v-if="suggestions.length" class="mapping-suggestion-list">
            <label
              v-for="proposal in suggestions"
              :key="proposal.proposalId"
              class="mapping-suggestion-row"
            >
              <input v-model="selectedProposalIds" type="checkbox" :value="proposal.proposalId" />
              <span class="mapping-node-copy">
                <small>{{ proposal.nodeId }} · {{ proposal.operation }}</small>
                <strong>{{ proposal.originalValue || '链接目标' }}</strong>
                <em>{{ proposal.reason }}</em>
              </span>
              <code>{{ proposalVariable(proposal) }}</code>
              <b>{{ Math.round(proposal.confidence * 100) }}%</b>
            </label>
          </div>
          <div v-else class="admin-empty">
            当前页面没有可自动确认的变量，创建后可以从节点列表手动绑定。
          </div>
        </section>
      </div>

      <label
        v-if="importResult.status === 'needs_review' && !blockers.length"
        class="template-warning-confirm"
      >
        <input v-model="confirmWarnings" type="checkbox" />
        <span><strong>我已查看扫描变化</strong><small>被移除的脚本和事件不会在模板中运行。</small></span>
      </label>
      <footer class="template-create-actions">
        <button class="button secondary" type="button" @click="step = 2">重新选择文件</button>
        <button
          class="button"
          type="button"
          :disabled="pending || !canCommit"
          @click="commitHtmlTemplate"
        >
          {{ pending ? '正在创建…' : '创建 HTML 模板' }}
        </button>
      </footer>
    </section>

    <section v-else-if="step === 4" class="template-create-complete">
      <span aria-hidden="true">✓</span>
      <p class="eyebrow">TEMPLATE READY</p>
      <h2>{{ replacing ? 'HTML 草稿已更新' : '模板草稿已创建' }}</h2>
      <p>
        {{
          source === 'html'
            ? `已应用 ${selectedProposalIds.length} 条动态变量建议。`
            : '结构化模板已经准备好继续编辑。'
        }}
      </p>
      <div class="template-complete-actions">
        <button class="button" type="button" @click="openEditor">进入模板编辑器</button>
        <button
          class="button secondary"
          type="button"
          @click="router.push({ name: 'manage-templates' })"
        >
          返回模板管理
        </button>
      </div>
      <small v-if="canPublish">模板仍是草稿，完成预览和校验后可以发布 V1。</small>
    </section>
  </main>
</template>
