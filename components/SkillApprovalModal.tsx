import React, { useEffect, useState } from 'react';
import { ShieldAlert, X, Check, Edit3 } from 'lucide-react';
import { setSkillApprovalHandler, PendingSkillApproval } from '../services/agentBootstrap';

type Decision =
    | { approved: true; finalCode?: string; finalPermissions?: string[] }
    | { approved: false; reason?: string };

interface PendingState extends PendingSkillApproval {
    resolve: (d: Decision) => void;
}

/**
 * SkillApprovalModal must be mounted once at App-level. It installs a
 * handler that agentBootstrap will invoke whenever the model calls
 * propose_new_skill (and YOLO mode is off).
 */
const SkillApprovalModal: React.FC = () => {
    const [pending, setPending] = useState<PendingState | null>(null);
    const [editCode, setEditCode] = useState('');
    const [editPerms, setEditPerms] = useState('');

    useEffect(() => {
        setSkillApprovalHandler((req) => {
            return new Promise<Decision>((resolve) => {
                setEditCode(req.jsCode);
                setEditPerms((req.requestedPermissions || []).join(', '));
                setPending({ ...req, resolve });
            });
        });
        return () => setSkillApprovalHandler(null);
    }, []);

    if (!pending) return null;

    const finish = (d: Decision) => {
        pending.resolve(d);
        setPending(null);
        setEditCode('');
        setEditPerms('');
    };

    const onApprove = () => {
        const perms = editPerms.split(',').map(s => s.trim()).filter(Boolean);
        finish({ approved: true, finalCode: editCode, finalPermissions: perms });
    };

    const onReject = () => finish({ approved: false, reason: 'User rejected the skill.' });

    return (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
            <div className="fixed inset-0 bg-black/80 backdrop-blur-xl" onClick={onReject} />
            <div className="relative w-full max-w-2xl bg-black border border-[#00ff41]/30 rounded-2xl shadow-2xl p-6 max-h-[90dvh] overflow-y-auto font-mono text-[#00ff41]">
                <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-3">
                        <ShieldAlert size={22} />
                        <div>
                            <h2 className="text-lg tracking-widest uppercase">New Skill Request</h2>
                            <p className="text-[10px] text-[#00ff41]/60 uppercase tracking-widest">
                                Review before granting Echo a new capability
                            </p>
                        </div>
                    </div>
                    <button onClick={onReject} className="p-2 text-[#00ff41]/60 hover:text-[#00ff41]">
                        <X size={18} />
                    </button>
                </div>

                <div className="space-y-4">
                    <div>
                        <div className="text-[10px] uppercase tracking-widest text-[#00ff41]/60 mb-1">
                            Name
                        </div>
                        <div className="text-sm">{pending.name}</div>
                    </div>

                    <div>
                        <div className="text-[10px] uppercase tracking-widest text-[#00ff41]/60 mb-1">
                            Purpose
                        </div>
                        <div className="text-sm whitespace-pre-wrap text-[#00ff41]/80">
                            {pending.purpose}
                        </div>
                    </div>

                    <div>
                        <div className="text-[10px] uppercase tracking-widest text-[#00ff41]/60 mb-1">
                            Function Schema
                        </div>
                        <pre className="text-[10px] bg-[#00ff41]/5 border border-[#00ff41]/20 rounded p-2 overflow-x-auto whitespace-pre-wrap">
                            {JSON.stringify(pending.schema, null, 2)}
                        </pre>
                    </div>

                    <div>
                        <div className="flex items-center gap-2 text-[10px] uppercase tracking-widest text-[#00ff41]/60 mb-1">
                            <Edit3 size={12} /> Permissions (comma-separated hosts; empty = no network)
                        </div>
                        <input
                            type="text"
                            value={editPerms}
                            onChange={e => setEditPerms(e.target.value)}
                            placeholder="api.example.com, data.example.org"
                            className="w-full bg-black/50 border border-[#00ff41]/20 rounded p-2 text-xs"
                        />
                    </div>

                    <div>
                        <div className="flex items-center gap-2 text-[10px] uppercase tracking-widest text-[#00ff41]/60 mb-1">
                            <Edit3 size={12} /> Code (sandboxed in Web Worker)
                        </div>
                        <textarea
                            value={editCode}
                            onChange={e => setEditCode(e.target.value)}
                            className="w-full bg-black/50 border border-[#00ff41]/20 rounded p-2 text-[11px] font-mono h-64 resize-y"
                        />
                    </div>

                    <div className="flex gap-3 pt-2">
                        <button
                            onClick={onApprove}
                            className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-[#00ff41]/15 border border-[#00ff41]/40 text-[#00ff41] rounded-lg hover:bg-[#00ff41]/25"
                        >
                            <Check size={16} /> Approve & Install
                        </button>
                        <button
                            onClick={onReject}
                            className="px-4 py-3 bg-rose-500/15 border border-rose-500/40 text-rose-300 rounded-lg hover:bg-rose-500/25"
                        >
                            Reject
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default SkillApprovalModal;
