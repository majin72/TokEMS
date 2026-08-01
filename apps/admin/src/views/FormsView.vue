<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import type { RegistrationField, RegistrationForm } from '@conference/contracts';
import { conferenceApi } from '../lib/api';
import { dateTime, statusLabel } from '../lib/format';

const versions = ref<RegistrationForm[]>([]);
const loading = ref(true);
const pending = ref(false);
const message = ref('');
const errorMessage = ref('');
const editor = reactive({
  name: '标准参会报名表',
  termsVersion: new Date().toISOString().slice(0, 10),
  termsContent: '提交报名即表示参会人同意大会报名服务条款与个人信息处理说明。',
  fields: [] as RegistrationField[],
});

function standardFields(): RegistrationField[] {
  return [
    { key: 'name', label: '姓名', type: 'text', required: true },
    { key: 'mobile', label: '手机号码', type: 'tel', required: true },
    { key: 'email', label: '电子邮箱', type: 'email', required: true },
    { key: 'company', label: '公司/机构', type: 'text', required: true },
    { key: 'title', label: '职位', type: 'text', required: true },
    { key: 'city', label: '所在城市', type: 'text', required: true },
  ];
}

async function load() {
  loading.value = true;
  errorMessage.value = '';
  try {
    versions.value = await conferenceApi.getForms();
    const current = versions.value[0];
    if (current) {
      editor.name = current.name;
      editor.termsVersion = current.termsVersion;
      editor.termsContent = current.termsContent;
      editor.fields = current.fields.map((field) => ({
        key: field.key,
        label: field.label,
        type: field.type,
        required: field.required,
        ...(field.placeholder ? { placeholder: field.placeholder } : {}),
        ...(field.options ? { options: [...field.options] } : {}),
      }));
    } else {
      editor.fields = standardFields();
    }
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '报名表版本读取失败';
    if (!editor.fields.length) editor.fields = standardFields();
  } finally {
    loading.value = false;
  }
}

function addField() {
  editor.fields.push({
    key: `custom_${editor.fields.length + 1}`,
    label: '自定义字段',
    type: 'text',
    required: false,
  });
}

function updateOptions(field: RegistrationField, value: string) {
  field.options = value
    .split(/\n|、|，|,|；|;/)
    .map((item) => item.trim())
    .filter(Boolean);
}

async function publish() {
  pending.value = true;
  errorMessage.value = '';
  try {
    const result = await conferenceApi.publishForm({
      name: editor.name,
      fields: editor.fields,
      termsVersion: editor.termsVersion,
      termsContent: editor.termsContent,
    });
    message.value = `报名表 V${result.version} 已发布，新报名将固化当前表单与条款快照。`;
    await load();
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '表单发布失败';
  } finally {
    pending.value = false;
  }
}

onMounted(() => void load());
</script>

<template>
  <header class="admin-page-head reveal is-visible">
    <div>
      <p class="eyebrow">VERSIONED CONSENT</p>
      <h1>报名表与条款版本</h1>
      <p>发布新版本后，历史报名继续保留当时确认的字段、条款正文和同意时间。</p>
    </div>
    <button class="button secondary" type="button" @click="addField">＋ 添加字段</button>
  </header>
  <p v-if="errorMessage" class="admin-error" role="alert">{{ errorMessage }}</p>
  <p v-if="message" class="admin-success" role="status">{{ message }}</p>
  <div v-if="loading" class="admin-loading" role="status">正在读取报名表版本…</div>

  <div v-else class="content-grid">
    <section class="admin-panel">
      <header class="admin-panel-header">
        <div>
          <h2>表单编辑器</h2>
          <p>字段键用于数据契约，发布后请保持语义稳定</p>
        </div>
      </header>
      <form class="event-form" @submit.prevent="publish">
        <div class="form-grid">
          <div class="form-field">
            <label for="registration-form-name">表单名称</label><input id="registration-form-name" v-model="editor.name" required />
          </div>
          <div class="form-field">
            <label for="registration-terms-version">条款版本</label><input id="registration-terms-version" v-model="editor.termsVersion" required />
          </div>
          <div class="form-field full">
            <label for="registration-terms-content">条款正文</label><textarea
              id="registration-terms-content"
              v-model="editor.termsContent"
              required
              minlength="10"
            ></textarea>
          </div>
        </div>
        <div class="field-builder">
          <div class="field-builder-header" aria-hidden="true">
            <span>字段键</span><span>显示名称</span><span>类型</span><span>占位提示</span><span>可选值</span><span>必填</span><span>操作</span>
          </div>
          <div
            v-for="(field, index) in editor.fields"
            :key="`${field.key}-${index}`"
            class="field-builder-row"
          >
            <strong class="field-builder-index">字段 {{ String(index + 1).padStart(2, '0') }}</strong>
            <label class="field-builder-cell">
              <span class="field-cell-label">字段键</span>
              <input
                v-model="field.key"
                :aria-label="`字段 ${index + 1} 的字段键`"
                required
                placeholder="field_key"
              />
            </label>
            <label class="field-builder-cell">
              <span class="field-cell-label">显示名称</span>
              <input
                v-model="field.label"
                :aria-label="`字段 ${index + 1} 的显示名称`"
                required
                placeholder="字段名称"
              />
            </label>
            <label class="field-builder-cell">
              <span class="field-cell-label">类型</span>
              <select v-model="field.type" :aria-label="`字段 ${index + 1} 的类型`">
                <option value="text">文本</option>
                <option value="email">邮箱</option>
                <option value="tel">手机</option>
                <option value="select">选项</option>
              </select>
            </label>
            <label class="field-builder-cell">
              <span class="field-cell-label">占位提示</span>
              <input
                v-model="field.placeholder"
                :aria-label="`字段 ${index + 1} 的占位提示`"
                placeholder="占位提示"
              />
            </label>
            <label class="field-builder-cell">
              <span class="field-cell-label">可选值</span>
              <input
                v-if="field.type === 'select'"
                :value="field.options?.join('、') ?? ''"
                :aria-label="`字段 ${index + 1} 的可选值`"
                placeholder="选项A、选项B"
                @input="updateOptions(field, ($event.target as HTMLInputElement).value)"
              />
              <span v-else class="field-empty-value">无需填写</span>
            </label>
            <label class="field-builder-required">
              <input v-model="field.required" type="checkbox" />
              <span>必填</span>
            </label>
            <div class="field-builder-action">
              <button
                class="row-action"
                type="button"
                :aria-label="`删除字段 ${index + 1}`"
                @click="editor.fields.splice(index, 1)"
              >
                ×
              </button>
            </div>
          </div>
        </div>
        <div class="event-form-actions">
          <button class="button" type="submit" :disabled="pending || !editor.fields.length">
            {{ pending ? '正在发布…' : '发布新版本' }}
          </button>
        </div>
      </form>
    </section>

    <section class="admin-panel">
      <header class="admin-panel-header">
        <div>
          <h2>版本记录</h2>
          <p>已发布版本保持不可变</p>
        </div>
        <span class="status-badge">{{ versions.length }} VERSIONS</span>
      </header>
      <ul class="operations-list">
        <li v-for="item in versions" :key="item.id">
          <div>
            <strong>V{{ item.version }} · {{ item.name }}</strong><small>条款 {{ item.termsVersion }} · {{ item.fields.length }} 个字段 ·
              {{ item.publishedAt ? dateTime(item.publishedAt) : '草稿' }}</small>
          </div>
          <span class="status-badge" :class="{ success: item.status === 'published' }">{{
            statusLabel(item.status)
          }}</span>
        </li>
      </ul>
      <div v-if="!versions.length" class="admin-empty">
        尚无已发布版本，当前编辑器已载入标准报名字段。
      </div>
    </section>
  </div>
</template>
