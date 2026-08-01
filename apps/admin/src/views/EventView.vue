<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import type { EventStatus, PublicEvent, UpdateEvent } from '@conference/contracts';
import { conferenceApi, publicEventUrl } from '../lib/api';

const event = ref<PublicEvent>();
const pending = ref(false);
const message = ref('');
const errorMessage = ref('');
const form = reactive({
  name: '',
  shortName: '',
  tagline: '',
  description: '',
  venue: '',
  city: '',
  address: '',
  startsAt: '',
  endsAt: '',
  timezone: 'Asia/Shanghai',
  status: 'registration_open' as EventStatus,
});

const statusLabels: Record<EventStatus, string> = {
  draft: '草稿',
  configuring: '配置中',
  prepublished: '预发布',
  registration_open: '报名开放',
  in_progress: '进行中',
  ended: '已结束',
  archived: '已归档',
};
const statusTransitions: Record<EventStatus, EventStatus[]> = {
  draft: ['configuring', 'archived'],
  configuring: ['draft', 'prepublished', 'archived'],
  prepublished: ['configuring', 'registration_open', 'archived'],
  registration_open: ['configuring', 'in_progress', 'ended', 'archived'],
  in_progress: ['ended', 'archived'],
  ended: ['archived'],
  archived: [],
};
const availableStatuses = computed(() => {
  const current = event.value?.status ?? form.status;
  return [current, ...statusTransitions[current]].map((value) => ({
    value,
    label: statusLabels[value],
  }));
});

function toLocalDateTime(value: string) {
  const date = new Date(value);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

async function load() {
  errorMessage.value = '';
  try {
    const loaded = await conferenceApi.getEvent();
    event.value = loaded;
    Object.assign(form, {
      name: loaded.name,
      shortName: loaded.shortName,
      tagline: loaded.tagline,
      description: loaded.description,
      venue: loaded.venue,
      city: loaded.city,
      address: loaded.address,
      startsAt: toLocalDateTime(loaded.startsAt),
      endsAt: toLocalDateTime(loaded.endsAt),
      timezone: loaded.timezone,
      status: loaded.status,
    });
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '大会数据读取失败';
  }
}

onMounted(load);

async function save() {
  pending.value = true;
  message.value = '';
  errorMessage.value = '';
  try {
    const patch: UpdateEvent = {
      name: form.name.trim(),
      shortName: form.shortName.trim(),
      tagline: form.tagline.trim(),
      description: form.description.trim(),
      venue: form.venue.trim(),
      city: form.city.trim(),
      address: form.address.trim(),
      startsAt: new Date(form.startsAt).toISOString(),
      endsAt: new Date(form.endsAt).toISOString(),
      timezone: form.timezone,
      status: form.status,
    };
    event.value = await conferenceApi.updateEvent(patch);
    message.value = '大会草稿已保存，发布新版本后同步到前台。';
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '保存失败';
  } finally {
    pending.value = false;
  }
}
</script>

<template>
  <header class="admin-page-head reveal is-visible">
    <div>
      <p class="eyebrow">EVENT SETTINGS / GENERAL</p>
      <h1>基本信息</h1>
      <p>维护大会名称、时间、地点和生命周期状态。</p>
    </div>
    <div class="admin-head-actions">
      <a class="button secondary" :href="publicEventUrl()" target="_blank" rel="noopener noreferrer">预览前台 ↗</a>
      <button class="button" type="button" :disabled="pending" @click="save">
        {{ pending ? '保存中…' : '保存修改' }}
      </button>
    </div>
  </header>

  <p v-if="message" class="admin-success" role="status">{{ message }}</p>
  <p v-if="errorMessage" class="admin-error" role="alert">{{ errorMessage }}</p>

  <section class="admin-panel reveal is-visible">
    <header class="admin-panel-header">
      <div>
        <h2>大会基本资料</h2>
        <p>保存到大会草稿，发布时生成一份稳定快照</p>
      </div>
      <span class="status-badge">{{ statusLabels[event?.status ?? form.status] }}</span>
    </header>
    <form class="event-form settings-form-spaced" @submit.prevent="save">
      <div class="form-grid">
        <div class="form-field">
          <label for="event-name">大会名称</label><input id="event-name" v-model="form.name" required />
        </div>
        <div class="form-field">
          <label for="event-short-name">短名称</label><input id="event-short-name" v-model="form.shortName" required />
        </div>
        <div class="form-field full">
          <label for="event-tagline">核心主张</label><input id="event-tagline" v-model="form.tagline" required />
        </div>
        <div class="form-field full">
          <label for="event-description">大会简介</label><textarea id="event-description" v-model="form.description" required></textarea>
        </div>
        <div class="form-field">
          <label for="event-starts-at">开始时间</label>
          <input id="event-starts-at" v-model="form.startsAt" type="datetime-local" required />
        </div>
        <div class="form-field">
          <label for="event-ends-at">结束时间</label>
          <input id="event-ends-at" v-model="form.endsAt" type="datetime-local" required />
        </div>
        <div class="form-field">
          <label for="event-timezone">时区</label>
          <select id="event-timezone" v-model="form.timezone">
            <option value="Asia/Shanghai">Asia/Shanghai</option>
            <option value="Asia/Hong_Kong">Asia/Hong_Kong</option>
            <option value="Asia/Singapore">Asia/Singapore</option>
            <option value="UTC">UTC</option>
          </select>
        </div>
        <div class="form-field">
          <label for="event-status">生命周期状态</label>
          <select id="event-status" v-model="form.status">
            <option v-for="item in availableStatuses" :key="item.value" :value="item.value">
              {{ item.label }}
            </option>
          </select>
        </div>
        <div class="form-field">
          <label for="event-city">城市</label><input id="event-city" v-model="form.city" required />
        </div>
        <div class="form-field">
          <label for="event-venue">会场</label><input id="event-venue" v-model="form.venue" required />
        </div>
        <div class="form-field full">
          <label for="event-address">详细地址</label><input id="event-address" v-model="form.address" required />
        </div>
      </div>
      <div class="event-form-actions">
        <button class="button" type="submit" :disabled="pending">
          {{ pending ? '保存中…' : '保存基本信息' }}
        </button>
      </div>
    </form>
  </section>
</template>
