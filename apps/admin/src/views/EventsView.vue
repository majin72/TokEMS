<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import type { ConferenceTemplateOption, EventId, EventSummary } from '@conference/contracts';
import { useRouter } from 'vue-router';
import { conferenceApi, session } from '../lib/api';
import { dateTime, statusClass, statusLabel } from '../lib/format';
import { localDateTimeToIso } from '../lib/timezone';

const router = useRouter();
const rows = ref<EventSummary[]>([]);
const templates = ref<ConferenceTemplateOption[]>([]);
const loading = ref(true);
const preparingForm = ref(false);
const pending = ref(false);
const quickTemplatePending = ref(false);
const errorMessage = ref('');
const successMessage = ref('');
const showCreateForm = ref(false);
const showQuickTemplate = ref(false);
const currentStep = ref(1);
const tagFilter = ref('');
const canCreateEvent = computed(() => session.canAll(['event.manage', 'org.template.use']));
const canCreateTemplate = computed(
  () => session.can('org.template.manage') && session.can('org.template.publish'),
);
const availableTags = computed(() => [...new Set(templates.value.flatMap((item) => item.tags))]);
const filteredTemplates = computed(() =>
  templates.value.filter((item) => !tagFilter.value || item.tags.includes(tagFilter.value)),
);
const selectedTemplate = computed(() =>
  templates.value.find((item) => item.currentPublishedVersionId === form.templateVersionId),
);
const form = reactive({
  name: '',
  shortName: '',
  slug: '',
  startsAt: '2027-06-18T09:00',
  endsAt: '2027-06-19T18:00',
  timezone: 'Asia/Shanghai',
  venue: '',
  city: '深圳',
  address: '',
  templateVersionId: '',
});
const quickTemplateForm = reactive({
  name: '',
  description: '',
  tags: '',
  sourceTemplateVersionId: '',
});

function basicInformationValid() {
  try {
    return Boolean(
      form.name.trim().length >= 2 &&
      form.shortName.trim().length >= 2 &&
      /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(form.slug) &&
      form.startsAt &&
      form.endsAt &&
      form.timezone.trim() &&
      new Date(localDateTimeToIso(form.endsAt, form.timezone)) >
        new Date(localDateTimeToIso(form.startsAt, form.timezone)) &&
      form.city.trim() &&
      form.venue.trim() &&
      form.address.trim(),
    );
  } catch {
    return false;
  }
}

async function load() {
  loading.value = true;
  errorMessage.value = '';
  try {
    rows.value = await conferenceApi.getEvents();
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '大会列表读取失败';
  } finally {
    loading.value = false;
  }
}

async function openCreateForm() {
  showCreateForm.value = true;
  currentStep.value = 1;
  errorMessage.value = '';
  preparingForm.value = true;
  try {
    const [templateOptions, organization] = await Promise.all([
      conferenceApi.getTemplateOptions(),
      session.canAny(['org.settings.read', 'org.member.manage'])
        ? conferenceApi.getOrganizationSettings()
        : Promise.resolve(undefined),
    ]);
    templates.value = templateOptions;
    if (organization) {
      form.timezone = organization.settings.defaultTimezone;
      const preferred = templateOptions.find(
        (item) => item.id === organization.settings.defaultTemplateId,
      );
      form.templateVersionId =
        preferred?.currentPublishedVersionId ?? templateOptions[0]?.currentPublishedVersionId ?? '';
    } else {
      form.templateVersionId = templateOptions[0]?.currentPublishedVersionId ?? '';
    }
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '创建大会配置读取失败';
  } finally {
    preparingForm.value = false;
  }
}

function closeCreateForm() {
  if (pending.value) return;
  showCreateForm.value = false;
  showQuickTemplate.value = false;
  errorMessage.value = '';
}

function nextStep() {
  errorMessage.value = '';
  if (currentStep.value === 1 && !basicInformationValid()) {
    errorMessage.value = '请完整填写基本信息，并确认结束时间晚于开始时间。';
    return;
  }
  if (currentStep.value === 2 && !form.templateVersionId) {
    errorMessage.value = '请选择一个已发布的大会模板版本。';
    return;
  }
  currentStep.value = Math.min(3, currentStep.value + 1);
}

function previousStep() {
  errorMessage.value = '';
  currentStep.value = Math.max(1, currentStep.value - 1);
}

function openQuickTemplate() {
  quickTemplateForm.sourceTemplateVersionId =
    form.templateVersionId ?? templates.value[0]?.currentPublishedVersionId ?? '';
  quickTemplateForm.name = form.name ? `${form.shortName || form.name} 模板` : '';
  quickTemplateForm.description = '从现有模板快速复制，供本场及后续大会复用。';
  quickTemplateForm.tags = selectedTemplate.value?.tags.join('、') ?? '';
  showQuickTemplate.value = true;
}

async function createQuickTemplate() {
  quickTemplatePending.value = true;
  errorMessage.value = '';
  try {
    const created = await conferenceApi.createConferenceTemplate({
      name: quickTemplateForm.name.trim(),
      description: quickTemplateForm.description.trim(),
      tags: quickTemplateForm.tags
        .split(/、|,|，/)
        .map((item) => item.trim())
        .filter(Boolean),
      ...(quickTemplateForm.sourceTemplateVersionId
        ? { sourceTemplateVersionId: quickTemplateForm.sourceTemplateVersionId }
        : {}),
      publishImmediately: true,
    });
    const option: ConferenceTemplateOption = {
      id: created.summary.id,
      name: created.summary.name,
      description: created.summary.description,
      tags: created.summary.tags,
      currentPublishedVersionId: created.summary.currentPublishedVersionId,
      currentVersion: created.summary.currentVersion,
      presentationKind: created.summary.presentationKind,
      previewAssetKey: created.summary.previewAssetKey,
      updatedAt: created.summary.updatedAt,
    };
    templates.value.unshift(option);
    form.templateVersionId = option.currentPublishedVersionId ?? '';
    showQuickTemplate.value = false;
    successMessage.value = `${option.name} V1 已创建并自动选中。`;
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '快速创建模板失败';
  } finally {
    quickTemplatePending.value = false;
  }
}

async function createEvent() {
  pending.value = true;
  errorMessage.value = '';
  successMessage.value = '';
  try {
    const created = (await conferenceApi.createEvent({
      name: form.name.trim(),
      shortName: form.shortName.trim(),
      slug: form.slug,
      startsAt: localDateTimeToIso(form.startsAt, form.timezone),
      endsAt: localDateTimeToIso(form.endsAt, form.timezone),
      timezone: form.timezone,
      venue: form.venue.trim(),
      city: form.city.trim(),
      address: form.address.trim(),
      templateVersionId: form.templateVersionId,
    })) as { id: EventId; name: string };
    successMessage.value = `${created.name} 已创建，模板绑定、报名表、票种骨架和核销入口已初始化。`;
    await load();
    showCreateForm.value = false;
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '创建大会失败';
  } finally {
    pending.value = false;
  }
}

function activate(item: EventSummary, routeName?: string) {
  session.setActiveEvent(item.id, item.slug);
  void router.push({
    name: routeName ?? session.eventLandingRouteName(),
    params: { eventId: item.id },
  });
}

onMounted(() => void load());
</script>

<template>
  <header class="admin-page-head reveal is-visible">
    <div>
      <p class="eyebrow">MULTI EVENT WORKSPACE</p>
      <h1>大会管理</h1>
      <p>创建和查找组织内的大会，并维护每场大会的模板绑定和发布状态。</p>
    </div>
    <span class="status-badge">{{ rows.length }} EVENTS</span>
  </header>
  <p v-if="errorMessage" class="admin-error" role="alert">{{ errorMessage }}</p>
  <p v-if="successMessage" class="admin-success" role="status">{{ successMessage }}</p>

  <div class="events-page-stack">
    <section v-if="!showCreateForm" class="admin-panel events-list-panel reveal is-visible">
      <header class="admin-panel-header">
        <div>
          <h2>大会列表</h2>
          <p>每一场大会拥有独立内容、业务数据和模板版本</p>
        </div>
        <button v-if="canCreateEvent" class="button" type="button" @click="openCreateForm">
          创建大会
        </button>
      </header>
      <div v-if="loading" class="admin-loading">正在读取大会列表…</div>
      <ul v-else-if="rows.length" class="operations-list event-management-list">
        <li v-for="item in rows" :key="item.id">
          <div>
            <strong>{{ item.name }}</strong>
            <small>
              {{ item.city }} · {{ dateTime(item.startsAt) }} · {{ item.registrationCount }} 人报名
            </small>
            <small class="event-template-line">
              模板：{{ item.templateName ?? '历史兼容模板' }}
              <template v-if="item.templateVersion"> · V{{ item.templateVersion }}</template>
              <b v-if="item.templateUpgradeAvailable" class="inline-warning">可升级</b>
            </small>
          </div>
          <div class="row-actions">
            <span class="status-badge event-status-slot" :class="statusClass(item.status)">
              {{ statusLabel(item.status) }}
            </span>
            <button
              v-if="session.can('event.site.read')"
              class="button secondary compact event-template-action"
              type="button"
              @click="activate(item, 'event-settings-site')"
            >
              设置模板
            </button>
            <button
              class="button secondary compact event-workspace-action"
              type="button"
              @click="activate(item)"
            >
              {{ item.id === session.activeEventId.value ? '继续管理' : '进入工作台' }}
            </button>
          </div>
        </li>
      </ul>
      <div v-else class="admin-empty">当前组织还没有大会。创建大会时需要选择一个已发布模板。</div>
    </section>

    <section v-else class="admin-panel event-create-panel reveal is-visible">
      <header class="admin-panel-header">
        <div>
          <h2>创建大会</h2>
          <p>选择不可变模板版本，初始化大会内容与报名流程</p>
        </div>
        <button class="button secondary" type="button" :disabled="pending" @click="closeCreateForm">
          返回大会列表
        </button>
      </header>

      <ol class="create-stepper" aria-label="创建大会步骤">
        <li :class="{ active: currentStep === 1, complete: currentStep > 1 }">
          <span>1</span><b>基本信息</b>
        </li>
        <li :class="{ active: currentStep === 2, complete: currentStep > 2 }">
          <span>2</span><b>选择模板</b>
        </li>
        <li :class="{ active: currentStep === 3 }"><span>3</span><b>确认创建</b></li>
      </ol>

      <div v-if="preparingForm" class="admin-loading">正在准备大会模板…</div>
      <form v-else class="event-form event-create-workflow" @submit.prevent="createEvent">
        <div v-if="currentStep === 1" class="form-grid">
          <div class="form-field">
            <label for="event-name">大会名称</label>
            <input id="event-name" v-model="form.name" required minlength="2" />
          </div>
          <div class="form-field">
            <label for="event-short">后台简称</label>
            <input id="event-short" v-model="form.shortName" required minlength="2" />
          </div>
          <div class="form-field full">
            <label for="event-slug">前台路径</label>
            <input
              id="event-slug"
              v-model="form.slug"
              required
              pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
              placeholder="tokems-demo-2027"
            />
          </div>
          <div class="form-field">
            <label for="event-start">开始时间</label>
            <input id="event-start" v-model="form.startsAt" type="datetime-local" required />
          </div>
          <div class="form-field">
            <label for="event-end">结束时间</label>
            <input id="event-end" v-model="form.endsAt" type="datetime-local" required />
          </div>
          <div class="form-field full">
            <label for="event-timezone">大会时区</label>
            <input
              id="event-timezone"
              v-model="form.timezone"
              list="event-timezone-options"
              required
              placeholder="Asia/Shanghai"
            />
            <datalist id="event-timezone-options">
              <option value="Asia/Shanghai" />
              <option value="Asia/Hong_Kong" />
              <option value="Asia/Tokyo" />
              <option value="Europe/London" />
              <option value="America/New_York" />
            </datalist>
            <small>开始与结束时间会按此时区保存和发布。</small>
          </div>
          <div class="form-field">
            <label for="event-city">城市</label>
            <input id="event-city" v-model="form.city" required />
          </div>
          <div class="form-field">
            <label for="event-venue">场馆</label>
            <input id="event-venue" v-model="form.venue" required />
          </div>
          <div class="form-field full">
            <label for="event-address">详细地址</label>
            <input id="event-address" v-model="form.address" required />
          </div>
        </div>

        <div v-else-if="currentStep === 2" class="template-selection-step">
          <div class="template-selection-toolbar">
            <label class="admin-select-label">
              <span>适用标签</span>
              <select v-model="tagFilter" class="admin-select">
                <option value="">全部模板</option>
                <option v-for="tag in availableTags" :key="tag" :value="tag">{{ tag }}</option>
              </select>
            </label>
            <button
              v-if="canCreateTemplate"
              class="button secondary"
              type="button"
              @click="openQuickTemplate"
            >
              新建模板
            </button>
          </div>
          <div v-if="filteredTemplates.length" class="template-option-list">
            <label
              v-for="item in filteredTemplates"
              :key="item.id"
              class="template-option-row"
              :class="{ selected: form.templateVersionId === item.currentPublishedVersionId }"
            >
              <input
                v-model="form.templateVersionId"
                type="radio"
                :value="item.currentPublishedVersionId ?? ''"
              />
              <span class="template-option-preview" aria-hidden="true">TokEMS</span>
              <span>
                <strong>{{ item.name }}</strong>
                <small>{{ item.description }}</small>
                <em>
                  V{{ item.currentVersion }} · {{ item.tags.join(' / ') || '通用模板' }} ·
                  {{ dateTime(item.updatedAt) }}
                </em>
              </span>
              <b>使用此模板</b>
            </label>
          </div>
          <div v-else class="admin-empty">当前筛选下没有可用模板。</div>
        </div>

        <div v-else class="creation-confirmation">
          <section>
            <h3>{{ form.name }}</h3>
            <p>
              {{ form.city }} · {{ form.venue }} · {{ form.startsAt.replace('T', ' ') }}（{{
                form.timezone
              }}）
            </p>
          </section>
          <section>
            <span>绑定模板</span>
            <strong>{{ selectedTemplate?.name }} · V{{ selectedTemplate?.currentVersion }}</strong>
            <p>{{ selectedTemplate?.description }}</p>
          </section>
          <div class="initialization-groups">
            <div>
              <b>复制</b>
              <p>首页结构、FAQ 骨架、报名表字段、条款和票种骨架</p>
            </div>
            <div>
              <b>重置</b>
              <p>库存销量、发布状态、报名开放状态和运营统计</p>
            </div>
            <div>
              <b>保持独立</b>
              <p>报名、订单、发票、签到和大会后续内容修改</p>
            </div>
          </div>
        </div>

        <aside v-if="showQuickTemplate" class="quick-template-drawer" aria-label="快速新建模板">
          <header>
            <div>
              <p class="eyebrow">QUICK TEMPLATE</p>
              <h3>新建并发布模板 V1</h3>
            </div>
            <button
              class="button secondary compact"
              type="button"
              @click="showQuickTemplate = false"
            >
              关闭
            </button>
          </header>
          <div class="form-field">
            <label for="quick-template-name">模板名称</label>
            <input id="quick-template-name" v-model="quickTemplateForm.name" required />
          </div>
          <div class="form-field">
            <label for="quick-template-description">适用场景</label>
            <textarea
              id="quick-template-description"
              v-model="quickTemplateForm.description"
              rows="4"
              required
            />
          </div>
          <div class="form-field">
            <label for="quick-template-tags">标签</label>
            <input
              id="quick-template-tags"
              v-model="quickTemplateForm.tags"
              placeholder="行业峰会、品牌大会"
            />
          </div>
          <div class="form-field">
            <label for="quick-template-source">复制来源</label>
            <select id="quick-template-source" v-model="quickTemplateForm.sourceTemplateVersionId">
              <option
                v-for="item in templates"
                :key="item.id"
                :value="item.currentPublishedVersionId ?? ''"
              >
                {{ item.name }} · V{{ item.currentVersion }}
              </option>
            </select>
          </div>
          <button
            class="button"
            type="button"
            :disabled="quickTemplatePending"
            @click="createQuickTemplate"
          >
            {{ quickTemplatePending ? '正在创建…' : '创建模板并自动选中' }}
          </button>
        </aside>

        <div class="event-form-actions event-create-actions">
          <button
            v-if="currentStep > 1"
            class="button secondary"
            type="button"
            :disabled="pending"
            @click="previousStep"
          >
            上一步
          </button>
          <button
            v-if="currentStep < 3"
            class="button"
            type="button"
            :disabled="pending"
            @click="nextStep"
          >
            下一步
          </button>
          <button v-else class="button" type="submit" :disabled="pending">
            {{ pending ? '正在创建…' : '创建大会项目' }}
          </button>
        </div>
      </form>
    </section>
  </div>
</template>
