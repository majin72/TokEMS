<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import type { CustomerAccountMode, EventPaymentMode, PublicEvent } from '@conference/contracts';
import { conferenceApi, session } from '../lib/api';
import { money } from '../lib/format';

interface InventoryRow {
  id: string;
  name: string;
  capacity: number;
  sold: number;
  reserved: number;
  available: number;
}

const event = ref<PublicEvent>();
const inventory = ref<InventoryRow[]>([]);
const archivedTickets = ref<
  Array<{ id: string; code: string; name: string; price: number; capacity: number }>
>([]);
const settingsPending = ref(false);
const ticketPending = ref(false);
const message = ref('');
const errorMessage = ref('');
const showTicketEditor = ref(false);
const editingTicketId = ref('');
const settingsForm = reactive({
  paymentMode: 'ticketed' as EventPaymentMode,
  registrationOpen: true,
  accountMode: 'mobile_otp_required' as CustomerAccountMode,
});
const ticketForm = reactive({
  code: '',
  name: '',
  description: '',
  priceYuan: 0,
  capacity: 100,
  recommended: false,
  benefits: '',
});

const isFree = computed(() => settingsForm.paymentMode === 'free');
const canManageRegistration = computed(() => session.can('event.manage'));
const canReadInventory = computed(() =>
  session.canAny(['event.inventory.read', 'event.inventory.manage']),
);
const canManageTickets = computed(() => session.can('event.inventory.manage'));

async function load(preserveSettings = false) {
  errorMessage.value = '';
  try {
    const [loaded, loadedInventory, loadedArchivedTickets] = await Promise.all([
      conferenceApi.getEvent(),
      canReadInventory.value ? conferenceApi.getInventory() : Promise.resolve([]),
      canManageTickets.value ? conferenceApi.getArchivedTicketTypes() : Promise.resolve([]),
    ]);
    event.value = loaded;
    inventory.value = loadedInventory;
    archivedTickets.value = loadedArchivedTickets;
    if (!preserveSettings) {
      settingsForm.paymentMode = loaded.registration.paymentMode;
      settingsForm.registrationOpen = loaded.registration.registrationOpen;
      settingsForm.accountMode = loaded.registration.accountMode;
    }
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '报名与票务设置读取失败';
  }
}

onMounted(load);

async function saveSettings() {
  if (isFree.value && event.value?.tickets.some((ticket) => ticket.price > 0)) {
    errorMessage.value = '免费报名模式下，所有票种价格需要设为 0 元。';
    return;
  }
  settingsPending.value = true;
  message.value = '';
  errorMessage.value = '';
  try {
    event.value = await conferenceApi.updateEvent({
      settings: {
        registration: {
          paymentMode: settingsForm.paymentMode,
          currency: 'CNY',
          registrationOpen: settingsForm.registrationOpen,
          accountMode: settingsForm.accountMode,
        },
      },
    });
    message.value = '报名方式已保存，发布新版本后同步到大会前台。';
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '报名方式保存失败';
  } finally {
    settingsPending.value = false;
  }
}

function resetTicketForm() {
  editingTicketId.value = '';
  Object.assign(ticketForm, {
    code: '',
    name: '',
    description: '',
    priceYuan: 0,
    capacity: 100,
    recommended: false,
    benefits: '',
  });
}

function createTicket() {
  resetTicketForm();
  showTicketEditor.value = true;
}

function editTicket(ticket: PublicEvent['tickets'][number]) {
  const stock = inventory.value.find((item) => item.id === ticket.id);
  editingTicketId.value = ticket.id;
  Object.assign(ticketForm, {
    code: '',
    name: ticket.name,
    description: ticket.description,
    priceYuan: ticket.price / 100,
    capacity: stock?.capacity ?? stock?.sold ?? ticket.remaining,
    recommended: ticket.recommended,
    benefits: ticket.benefits.join('\n'),
  });
  showTicketEditor.value = true;
}

async function saveTicket() {
  ticketPending.value = true;
  errorMessage.value = '';
  message.value = '';
  try {
    const payload = {
      ...(editingTicketId.value ? {} : { code: ticketForm.code.trim().toUpperCase() }),
      name: ticketForm.name.trim(),
      description: ticketForm.description.trim(),
      price: Math.round(Number(ticketForm.priceYuan) * 100),
      currency: 'CNY',
      capacity: Number(ticketForm.capacity),
      recommended: ticketForm.recommended,
      benefits: ticketForm.benefits
        .split(/\n|；|;/)
        .map((item) => item.trim())
        .filter(Boolean),
    };
    if (isFree.value && payload.price > 0) {
      throw new Error('免费报名模式下，票种价格需要设为 0 元。');
    }
    if (editingTicketId.value) {
      await conferenceApi.updateTicketType(editingTicketId.value, payload);
    } else {
      await conferenceApi.createTicketType({
        ...payload,
        code: ticketForm.code.trim().toUpperCase(),
      });
    }
    await load(true);
    showTicketEditor.value = false;
    resetTicketForm();
    message.value = '票种配置已保存，发布新版本后同步到大会前台。';
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '票种保存失败';
  } finally {
    ticketPending.value = false;
  }
}

async function removeTicket(ticket: PublicEvent['tickets'][number]) {
  if (!window.confirm(`确认下架票种“${ticket.name}”？发布新版本后将从前台移除。`)) return;
  errorMessage.value = '';
  try {
    await conferenceApi.deleteTicketType(ticket.id);
    await load(true);
    message.value = '票种已从草稿下架，发布新版本后同步到大会前台。';
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '票种删除失败';
  }
}

async function restoreTicket(ticket: (typeof archivedTickets.value)[number]) {
  errorMessage.value = '';
  try {
    await conferenceApi.restoreTicketType(ticket.id);
    await load(true);
    message.value = '票种已恢复到大会草稿，发布新版本后同步到大会前台。';
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '票种恢复失败';
  }
}
</script>

<template>
  <header class="admin-page-head reveal is-visible">
    <div>
      <p class="eyebrow">EVENT SETTINGS / REGISTRATION</p>
      <h1>报名与票务</h1>
      <p>选择免费报名或按票种收费，并维护可报名状态、价格与容量。</p>
    </div>
    <span class="status-badge" :class="isFree ? 'paid' : 'draft'">
      {{ isFree ? 'FREE' : 'TICKETED' }}
    </span>
  </header>

  <p v-if="message" class="admin-success" role="status">{{ message }}</p>
  <p v-if="errorMessage" class="admin-error" role="alert">{{ errorMessage }}</p>

  <section v-if="canManageRegistration" class="admin-panel">
    <header class="admin-panel-header">
      <div>
        <h2>报名方式</h2>
        <p>免费报名完成后直接出票，按票种收费会进入订单与支付</p>
      </div>
    </header>
    <form class="event-form settings-form-spaced" @submit.prevent="saveSettings">
      <div class="choice-card-grid">
        <label class="choice-card" :class="{ selected: settingsForm.paymentMode === 'free' }">
          <input v-model="settingsForm.paymentMode" type="radio" value="free" />
          <span>
            <strong>免费报名</strong>
            <small>票价统一为 0 元，提交后直接生成电子票</small>
          </span>
        </label>
        <label class="choice-card" :class="{ selected: settingsForm.paymentMode === 'ticketed' }">
          <input v-model="settingsForm.paymentMode" type="radio" value="ticketed" />
          <span>
            <strong>按票种收费</strong>
            <small>参会者选择票种，完成订单与支付后出票</small>
          </span>
        </label>
      </div>
      <label class="setting-toggle">
        <span>
          <strong>开放前台报名</strong>
          <small>关闭后保留前台页面，并暂停新的报名提交</small>
        </span>
        <input v-model="settingsForm.registrationOpen" type="checkbox" />
      </label>
      <div class="choice-card-grid registration-account-mode">
        <label
          class="choice-card"
          :class="{ selected: settingsForm.accountMode === 'mobile_otp_required' }"
        >
          <input v-model="settingsForm.accountMode" type="radio" value="mobile_otp_required" />
          <span>
            <strong>用户登录后报名</strong>
            <small>适合需要用户中心、跨大会历史和发票管理的大会</small>
          </span>
        </label>
        <label
          class="choice-card"
          :class="{ selected: settingsForm.accountMode === 'guest_allowed' }"
        >
          <input v-model="settingsForm.accountMode" type="radio" value="guest_allowed" />
          <span>
            <strong>允许游客直接报名</strong>
            <small>保留原有快速流程，登录用户的报名仍会进入用户中心</small>
          </span>
        </label>
      </div>
      <div class="event-form-actions">
        <button class="button" type="submit" :disabled="settingsPending">
          {{ settingsPending ? '保存中…' : '保存报名方式' }}
        </button>
      </div>
    </form>
  </section>

  <section v-if="canReadInventory || canManageTickets" class="admin-panel ticket-settings-panel">
    <header class="admin-panel-header">
      <div>
        <h2>票种与容量</h2>
        <p>
          {{
            isFree
              ? '免费模式下保留票种，用于区分参会权益与容量'
              : '价格以人民币计价，容量包含已售与预留库存'
          }}
        </p>
      </div>
      <button
        v-if="canManageTickets"
        class="button secondary compact"
        type="button"
        @click="createTicket"
      >
        新建票种
      </button>
    </header>
    <div class="data-table-wrap">
      <table class="data-table">
        <caption class="sr-only">
          票种与容量
        </caption>
        <thead>
          <tr>
            <th>票种</th>
            <th>价格</th>
            <th>已售 / 容量</th>
            <th>剩余</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="ticket in event?.tickets ?? []" :key="ticket.id">
            <td>
              <span class="row-title">{{ ticket.name }}</span>
              <span class="row-sub">{{ ticket.description }}</span>
            </td>
            <td>{{ ticket.price === 0 ? '免费' : money(ticket.price).replace('.00', '') }}</td>
            <td>
              {{ inventory.find((item) => item.id === ticket.id)?.sold ?? 0 }} /
              {{ inventory.find((item) => item.id === ticket.id)?.capacity ?? '未设置' }}
            </td>
            <td>{{ ticket.remaining }}</td>
            <td>
              <div v-if="canManageTickets" class="table-actions">
                <button class="button secondary compact" type="button" @click="editTicket(ticket)">
                  编辑
                </button>
                <button class="button danger compact" type="button" @click="removeTicket(ticket)">
                  下架
                </button>
              </div>
            </td>
          </tr>
          <tr v-if="!event?.tickets.length">
            <td colspan="5" class="admin-empty">暂无票种，请先创建一个可报名票种。</td>
          </tr>
        </tbody>
      </table>
    </div>
    <details v-if="canManageTickets && archivedTickets.length" class="advanced-permissions">
      <summary>已下架票种（{{ archivedTickets.length }}）</summary>
      <ul class="operations-list">
        <li v-for="ticket in archivedTickets" :key="ticket.id">
          <div>
            <strong>{{ ticket.name }}</strong>
            <small>{{ ticket.code }} · {{ money(ticket.price) }} · 容量 {{ ticket.capacity }}</small>
          </div>
          <button class="button secondary compact" type="button" @click="restoreTicket(ticket)">
            恢复到草稿
          </button>
        </li>
      </ul>
    </details>
  </section>

  <section v-if="canManageTickets && showTicketEditor" class="admin-panel ticket-editor-panel">
    <header class="admin-panel-header">
      <div>
        <h2>{{ editingTicketId ? '编辑票种' : '新建票种' }}</h2>
        <p>容量与库存即时生效，名称、权益和价格随下一次发布同步。</p>
      </div>
      <button class="button secondary compact" type="button" @click="showTicketEditor = false">
        关闭
      </button>
    </header>
    <form class="event-form settings-form-spaced" @submit.prevent="saveTicket">
      <div class="form-grid">
        <div v-if="!editingTicketId" class="form-field">
          <label for="ticket-code">票种编码</label>
          <input
            id="ticket-code"
            v-model="ticketForm.code"
            required
            maxlength="40"
            pattern="[A-Za-z0-9_]+"
            placeholder="EARLY_BIRD"
          />
        </div>
        <div class="form-field">
          <label for="ticket-name">票种名称</label><input id="ticket-name" v-model="ticketForm.name" required maxlength="100" />
        </div>
        <div class="form-field">
          <label for="ticket-price">价格（元）</label>
          <input
            id="ticket-price"
            v-model.number="ticketForm.priceYuan"
            type="number"
            min="0"
            step="0.01"
            required
          />
        </div>
        <div class="form-field">
          <label for="ticket-capacity">总容量</label>
          <input
            id="ticket-capacity"
            v-model.number="ticketForm.capacity"
            type="number"
            min="1"
            step="1"
            required
          />
        </div>
        <div class="form-field full">
          <label for="ticket-description">票种说明</label>
          <textarea
            id="ticket-description"
            v-model="ticketForm.description"
            required
            maxlength="2000"
          ></textarea>
        </div>
        <div class="form-field full">
          <label for="ticket-benefits">权益清单（每行一项）</label>
          <textarea
            id="ticket-benefits"
            v-model="ticketForm.benefits"
            placeholder="大会两日通票&#10;午餐与茶歇"
          ></textarea>
        </div>
        <label class="ticket-recommended">
          <input v-model="ticketForm.recommended" type="checkbox" />
          <span>在前台标记为推荐票种</span>
        </label>
      </div>
      <div class="event-form-actions">
        <button class="button secondary" type="button" @click="showTicketEditor = false">
          取消
        </button>
        <button class="button" type="submit" :disabled="ticketPending">
          {{ ticketPending ? '保存中…' : '保存票种' }}
        </button>
      </div>
    </form>
  </section>
</template>
