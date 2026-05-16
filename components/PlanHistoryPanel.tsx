import React, { useMemo } from 'react';
import { marketingPlanService } from '../services/marketingPlanService';

interface PlanHistoryPanelProps {
    compact?: boolean;
}

const PlanHistoryPanel: React.FC<PlanHistoryPanelProps> = ({ compact = false }) => {
    const plans = useMemo(() => marketingPlanService.listHistory().slice(0, compact ? 3 : 8), []);

    if (plans.length === 0) {
        return (
            <div className="bg-white/5 border border-white/10 rounded p-3">
                <p className="text-xs text-gray-500">No marketing plans generated yet.</p>
            </div>
        );
    }

    return (
        <div className="space-y-2">
            {plans.map((plan) => (
                <div key={plan.id} className="bg-white/5 border border-white/10 rounded p-3">
                    <div className="flex items-center justify-between gap-2">
                        <h4 className="text-xs font-semibold text-white truncate">{plan.title}</h4>
                        <span className="text-[10px] text-gray-400 uppercase">{plan.exportedFormat}</span>
                    </div>
                    <p className="text-[10px] text-gray-500 mt-1">
                        {new Date(plan.createdAt).toLocaleString()} - {plan.channels.join(', ')}
                    </p>
                    <p className="text-xs text-gray-300 mt-2 line-clamp-2">{plan.objective}</p>
                    <div className="text-[10px] text-gray-400 mt-2 flex gap-3">
                        <span>KPI: {plan.kpis.length}</span>
                        <span>Checklist: {plan.executionChecklist.length}</span>
                    </div>
                </div>
            ))}
        </div>
    );
};

export default PlanHistoryPanel;
