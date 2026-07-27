import React, { useMemo } from 'react';
import { marketingPlanService } from '../services/marketingPlanService';

interface PlanHistoryPanelProps {
    compact?: boolean;
}

const PlanHistoryPanel: React.FC<PlanHistoryPanelProps> = ({ compact = false }) => {
    const plans = useMemo(() => marketingPlanService.listHistory().slice(0, compact ? 3 : 8), []);

    if (plans.length === 0) {
        return (
            <div className="bg-[rgba(0,255,65,0.04)] border border-[var(--border-dim)] rounded p-3">
                <p className="text-xs font-mono text-[var(--text-tertiary)]">// No marketing plans generated yet.</p>
            </div>
        );
    }

    return (
        <div className="space-y-2">
            {plans.map((plan) => (
                <div key={plan.id} className="bg-[rgba(0,255,65,0.04)] border border-[var(--border-dim)] rounded p-3 hover:border-[var(--border-green)] transition-colors">
                    <div className="flex items-center justify-between gap-2">
                        <h4 className="text-xs font-hud font-semibold uppercase tracking-wide text-[var(--text-primary)] truncate">{plan.title}</h4>
                        <span className="text-[10px] font-mono uppercase text-[var(--accent-green)]">{plan.exportedFormat}</span>
                    </div>
                    <p className="text-[10px] font-mono text-[var(--text-tertiary)] mt-1">
                        {new Date(plan.createdAt).toLocaleString()} - {plan.channels.join(', ')}
                    </p>
                    <p className="text-xs text-[var(--text-secondary)] mt-2 line-clamp-2">{plan.objective}</p>
                    <div className="text-[10px] font-mono uppercase tracking-wide text-[var(--text-tertiary)] mt-2 flex gap-3">
                        <span>KPI: {plan.kpis.length}</span>
                        <span>Checklist: {plan.executionChecklist.length}</span>
                    </div>
                </div>
            ))}
        </div>
    );
};

export default PlanHistoryPanel;
