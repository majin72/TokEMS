import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Ref } from 'vue';
import PartnerDistributionView from './PartnerDistributionView.vue';

const api = vi.hoisted(() => ({
  getPartnerDistributionOverview: vi.fn(),
  getEventPartners: vi.fn(),
  getPartnerCommissions: vi.fn(),
  getPartnerCommissionInquiries: vi.fn(),
  getPartnerPayouts: vi.fn(),
  getPartnerPayoutSettings: vi.fn(),
  publishPartnerProgram: vi.fn(),
}));

vi.mock('../lib/api', async () => {
  const { ref } = await import('vue');
  return {
    conferenceApi: api,
    session: {
      can: () => true,
      activeEvent: ref({ id: 101, name: '第二届中国 GEO & AI 营销大会' }),
    },
  };
});

vi.mock('vue', async (original) => ({
  ...(await original<typeof import('vue')>()),
  onMounted: vi.fn(),
  useSSRContext: () => ({ modules: new Set() }),
}));

interface State {
  enableDialogOpen: Ref<boolean>;
  successMessage: Ref<string>;
  requestEnableDistribution: () => void;
  enableDistribution: () => Promise<void>;
}

function state() {
  const setup = PartnerDistributionView.setup;
  if (!setup) throw new Error('Partner distribution component has no setup function');
  return setup({}, { expose: vi.fn(), attrs: {}, slots: {}, emit: vi.fn() }) as unknown as State;
}

describe('partner distribution quick enable', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.publishPartnerProgram.mockResolvedValue({});
    api.getPartnerDistributionOverview.mockResolvedValue({
      program: {
        mode: 'fixed',
        fixedRateBps: 1000,
        attributionDays: 30,
        settlementDelayDays: 7,
        minimumPayoutAmount: 1000,
        publicDirectoryEnabled: false,
        homepageLimit: 12,
      },
      partnerCounts: {},
      commissionTotals: {},
      payoutTotals: {},
    });
    api.getEventPartners.mockResolvedValue({ items: [] });
    api.getPartnerCommissions.mockResolvedValue({ items: [] });
    api.getPartnerCommissionInquiries.mockResolvedValue({ items: [] });
    api.getPartnerPayouts.mockResolvedValue({
      requests: [],
      batches: [],
      inquiries: [],
      recipients: [],
      documents: [],
      reconciliations: [],
    });
    api.getPartnerPayoutSettings.mockResolvedValue({});
  });

  it('publishes the locked default rules after explicit confirmation', async () => {
    const view = state();
    view.requestEnableDistribution();
    expect(view.enableDialogOpen.value).toBe(true);

    await view.enableDistribution();

    expect(api.publishPartnerProgram).toHaveBeenCalledWith({
      mode: 'fixed',
      fixedRateBps: 1000,
      tiers: [],
      eligibleTicketTypeIds: [],
      attributionDays: 30,
      settlementDelayDays: 7,
      minimumPayoutAmount: 1000,
      payoutCadence: 'weekly',
      termsTitle: '大会合作伙伴推广规则',
      termsContent:
        '合作伙伴应使用本人专属链接开展真实推广。佣金按成功付款且符合资格的订单明细计算，退款与自购会按规则冲正。',
      promotionPolicy: '推广内容应真实、清晰，不得承诺大会未公开的权益。',
      publicDirectoryEnabled: false,
      homepageLimit: 12,
    });
    expect(view.successMessage.value).toBe(
      '分销功能已开启。合作伙伴确认规则后即可开始推广归因。',
    );
    expect(view.enableDialogOpen.value).toBe(false);
  });
});
