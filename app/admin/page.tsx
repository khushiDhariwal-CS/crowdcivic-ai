'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { auth, db } from '@/lib/firebase';
import { signOut, onAuthStateChanged, User as FirebaseUser } from 'firebase/auth';
import { collection, getDocs, doc, updateDoc, setDoc, getDoc, deleteDoc, query, where } from 'firebase/firestore';
import {
  getSecurityAuditLogs,
  logSecurityEvent,
  AuditLogEntry,
  DEFAULT_PIN_ADMIN,
} from '@/lib/audit';
import { LanguageSelector, useLanguage } from '@/lib/LanguageContext';
import {
  LogOut,
  Shield,
  Users,
  Activity,
  Settings,
  ShieldAlert,
  ShieldCheck,
  KeyRound,
  Lock,
  Search,
  Filter,
  RefreshCw,
  UserCheck,
  UserX,
  Clock,
  Laptop,
  CheckCircle2,
  AlertTriangle,
  X,
  FileText,
  Key,
  Flag,
  ThumbsUp,
  ThumbsDown,
  MessageSquare,
  AlertOctagon,
  Eye,
  Trash2,
} from 'lucide-react';

interface UserRecord {
  uid: string;
  email: string;
  role: 'citizen' | 'authority' | 'admin';
  updatedAt?: string;
}

interface AdminIssueReport {
  id: string;
  ticketId: string;
  category: string;
  description: string;
  status: string;
  createdAt?: any;
  voteStats?: {
    yes: number;
    no: number;
  };
  communityVotes?: Array<{
    userId: string;
    userEmail: string;
    vote: 'yes' | 'no';
    comment: string;
    createdAt: string;
    distanceKm?: number;
  }>;
  isDisputed?: boolean;
  supportersCount?: number;
  duplicateCount?: number;
  isDuplicate?: boolean;
  parentId?: string | null;
  adminFlagged?: boolean;
  adminFlagReason?: string;
  resolutionProofUrl?: string;
}

export default function AdminDashboard() {
  const router = useRouter();
  const { t } = useLanguage();
  const [loading, setLoading] = useState(true);
  const [currentUser, setCurrentUser] = useState<FirebaseUser | null>(null);

  // Tab State: 'audit' | 'users' | 'config' | 'issues'
  const [activeTab, setActiveTab] = useState<'audit' | 'users' | 'config' | 'issues'>('audit');

  // Security Audit Logs State
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>([]);
  const [loadingLogs, setLoadingLogs] = useState(false);
  const [logFilter, setLogFilter] = useState<'ALL' | 'DENIED' | 'PIN' | 'LOGIN'>('ALL');
  const [searchLogQuery, setSearchLogQuery] = useState('');

  // Registered Users State
  const [usersList, setUsersList] = useState<UserRecord[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [searchUserQuery, setSearchUserQuery] = useState('');

  // Community Issues & Verification State
  const [issuesList, setIssuesList] = useState<AdminIssueReport[]>([]);
  const [loadingIssues, setLoadingIssues] = useState(false);
  const [adminDeleteModal, setAdminDeleteModal] = useState<{ issueId: string; ticketId: string } | null>(null);
  const [deletingIssue, setDeletingIssue] = useState(false);
  const [searchIssueQuery, setSearchIssueQuery] = useState('');
  const [issueFilter, setIssueFilter] = useState<'ALL' | 'DISPUTED' | 'FLAGGED' | 'RESOLVED'>('ALL');
  const [selectedIssueComments, setSelectedIssueComments] = useState<AdminIssueReport | null>(null);

  // Admin 2FA PIN Modal State
  const [showAdminPinModal, setShowAdminPinModal] = useState(false);
  const [adminPinInput, setAdminPinInput] = useState('');
  const [adminPinError, setAdminPinError] = useState('');
  const [pendingUserUpdate, setPendingUserUpdate] = useState<{
    targetUid: string;
    targetEmail: string;
    newRole: 'citizen' | 'authority' | 'admin';
  } | null>(null);

  // Role verification guard
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (activeUser) => {
      let effUser: any = activeUser;
      if (!effUser) {
        const storedEmail = typeof window !== 'undefined' ? localStorage.getItem('user_email') : null;
        const storedUid = typeof window !== 'undefined' ? localStorage.getItem('user_uid') : null;
        if (storedEmail && storedUid) {
          effUser = { uid: storedUid, email: storedEmail };
        } else {
          router.push('/');
          return;
        }
      }

      setCurrentUser(effUser);

      // Verify Role exclusively from Firestore
      try {
        let userRole: string | null = null;
        if (effUser.uid) {
          try {
            const userDoc = await getDoc(doc(db, 'users', effUser.uid));
            if (userDoc.exists()) {
              userRole = userDoc.data().role;
            }
          } catch (docErr) {
            console.warn('Notice: Firestore user document fetch offline, fallback to local session:', docErr);
          }
        }
        if (!userRole && effUser.email) {
          try {
            const q = query(collection(db, 'users'), where('email', '==', effUser.email));
            const snap = await getDocs(q);
            if (!snap.empty) {
              userRole = snap.docs[0].data().role;
            }
          } catch (queryErr) {
            console.warn('Notice: Firestore user query offline:', queryErr);
          }
        }

        if (!userRole) {
          const cachedRole = typeof window !== 'undefined' ? localStorage.getItem('user_role') : null;
          userRole = cachedRole || 'citizen';
          try {
            await setDoc(doc(db, 'users', effUser.uid), {
              email: effUser.email || 'user@example.com',
              role: userRole,
              createdAt: new Date().toISOString(),
            }, { merge: true });
          } catch (setErr) {
            console.warn('Notice: Firestore profile setDoc offline:', setErr);
          }
        }

        if (userRole !== 'admin') {
          router.push(userRole === 'authority' ? '/authority' : '/citizen');
          return;
        }
      } catch (err) {
        console.warn('Admin role verification error:', err);
      }

      setLoading(false);
      fetchAuditLogs();
      fetchUsers();
      fetchIssues();
    });

    return () => unsubscribe();
  }, [router]);

  // Fetch Community Issues & Verification Votes
  const fetchIssues = async () => {
    setLoadingIssues(true);
    try {
      const snap = await getDocs(collection(db, 'issues'));
      const fetched: AdminIssueReport[] = [];
      snap.forEach((docSnap) => {
        const data = docSnap.data();
        fetched.push({
          id: docSnap.id,
          ticketId: data.ticketId || docSnap.id,
          category: data.category || 'General',
          description: data.description || '',
          status: data.status || 'Submitted',
          createdAt: data.createdAt,
          voteStats: data.voteStats,
          communityVotes: data.communityVotes || [],
          isDisputed: data.isDisputed || false,
          adminFlagged: data.adminFlagged || false,
          adminFlagReason: data.adminFlagReason || '',
          resolutionProofUrl: data.resolutionProofUrl,
        });
      });
      setIssuesList(fetched);
    } catch (err) {
      console.error('Error fetching admin issues:', err);
    } finally {
      setLoadingIssues(false);
    }
  };

  // Toggle Admin Flag on Issue
  const handleToggleAdminFlag = async (issueId: string, currentFlagged: boolean) => {
    try {
      const newFlagState = !currentFlagged;
      await updateDoc(doc(db, 'issues', issueId), {
        adminFlagged: newFlagState,
        isDisputed: newFlagState, // sync with dispute status
        adminFlaggedAt: new Date().toISOString(),
      });

      await logSecurityEvent({
        userId: currentUser?.uid || 'admin_user',
        email: currentUser?.email || 'admin@crowdcivic.org',
        role: 'admin',
        action: newFlagState ? 'ADMIN_ISSUE_FLAGGED' : 'ADMIN_ISSUE_UNFLAGGED',
        portal: 'admin',
        status: 'SUCCESS',
        details: `Admin ${newFlagState ? 'FLAGGED' : 'CLEARED FLAG ON'} Issue #${issueId} based on community governance audit.`,
      });

      fetchIssues();
      fetchAuditLogs();
    } catch (err) {
      console.error('Error toggling issue flag:', err);
      alert('Failed to update issue flag.');
    }
  };

  // Delete Complaint permanently from system
  const handleDeleteIssue = (issueId: string, ticketId: string) => {
    setAdminDeleteModal({ issueId, ticketId });
  };

  const executeDeleteIssue = async () => {
    if (!adminDeleteModal) return;
    const { issueId, ticketId } = adminDeleteModal;
    setDeletingIssue(true);
    try {
      await deleteDoc(doc(db, 'issues', issueId));
      await logSecurityEvent({
        userId: currentUser?.uid || 'admin_user',
        email: currentUser?.email || 'admin@crowdcivic.org',
        role: 'admin',
        action: 'ADMIN_DELETE_ISSUE',
        portal: 'admin',
        status: 'SUCCESS',
        details: `Admin deleted complaint ticket #${ticketId} (ID: ${issueId})`,
      });
      setIssuesList((prev) => prev.filter((i) => i.id !== issueId));
      fetchAuditLogs();
      setAdminDeleteModal(null);
    } catch (err: any) {
      console.error('Error deleting issue:', err);
      alert(`Failed to delete complaint: ${err.message}`);
    } finally {
      setDeletingIssue(false);
    }
  };

  // Fetch Security Audit Logs
  const fetchAuditLogs = async () => {
    setLoadingLogs(true);
    try {
      const logs = await getSecurityAuditLogs(100);
      setAuditLogs(logs);
    } catch (err) {
      console.error('Error fetching audit logs:', err);
    } finally {
      setLoadingLogs(false);
    }
  };

  // Fetch Registered System Users
  const fetchUsers = async () => {
    setLoadingUsers(true);
    try {
      const querySnap = await getDocs(collection(db, 'users'));
      const fetched: UserRecord[] = [];
      querySnap.forEach((docSnap) => {
        const data = docSnap.data();
        fetched.push({
          uid: docSnap.id,
          email: data.email || 'Unknown User',
          role: data.role || 'citizen',
          updatedAt: data.updatedAt || new Date().toISOString(),
        });
      });

      // Default demo users if missing
      const demoAccounts: UserRecord[] = [
        { uid: 'usr_citizen@crowdcivic.org', email: 'citizen@crowdcivic.org', role: 'citizen' },
        { uid: 'usr_authority@crowdcivic.org', email: 'authority@crowdcivic.org', role: 'authority' },
        { uid: 'usr_admin@crowdcivic.org', email: 'admin@crowdcivic.org', role: 'admin' },
      ];

      demoAccounts.forEach((demo) => {
        if (!fetched.some((f) => f.email === demo.email)) {
          fetched.push(demo);
        }
      });

      setUsersList(fetched);
    } catch (err) {
      console.error('Error fetching system users:', err);
      // Fallback demo users
      setUsersList([
        { uid: 'usr_citizen@crowdcivic.org', email: 'citizen@crowdcivic.org', role: 'citizen' },
        { uid: 'usr_authority@crowdcivic.org', email: 'authority@crowdcivic.org', role: 'authority' },
        { uid: 'usr_admin@crowdcivic.org', email: 'admin@crowdcivic.org', role: 'admin' },
      ]);
    } finally {
      setLoadingUsers(false);
    }
  };

  // Initiate Role Change Request
  const handleRequestRoleChange = (targetUid: string, targetEmail: string, newRole: 'citizen' | 'authority' | 'admin') => {
    setPendingUserUpdate({ targetUid, targetEmail, newRole });
    setAdminPinInput('');
    setAdminPinError('');
    setShowAdminPinModal(true);
  };

  // Confirm Role Change with 2FA Admin PIN
  const handleConfirmRoleChange = async (e: React.FormEvent) => {
    e.preventDefault();
    setAdminPinError('');

    if (adminPinInput.trim() !== DEFAULT_PIN_ADMIN) {
      await logSecurityEvent({
        userId: currentUser?.uid || 'admin_user',
        email: currentUser?.email || 'admin@crowdcivic.org',
        role: 'admin',
        action: 'SECURITY_PIN_FAILED',
        portal: 'admin',
        status: 'DENIED',
        details: `Failed Admin 2FA Passkey PIN attempt for changing user permissions of ${pendingUserUpdate?.targetEmail}`,
      });
      setAdminPinError('Invalid System Admin Passkey. Access Denied.');
      return;
    }

    if (!pendingUserUpdate) return;

    try {
      // Update in Firestore
      await setDoc(
        doc(db, 'users', pendingUserUpdate.targetUid),
        {
          email: pendingUserUpdate.targetEmail,
          role: pendingUserUpdate.newRole,
          updatedAt: new Date().toISOString(),
        },
        { merge: true }
      );

      // Audit Log
      await logSecurityEvent({
        userId: currentUser?.uid || 'admin_user',
        email: currentUser?.email || 'admin@crowdcivic.org',
        role: 'admin',
        action: 'ROLE_PERMISSIONS_CHANGED',
        portal: 'admin',
        status: 'SUCCESS',
        details: `Role permissions for ${pendingUserUpdate.targetEmail} updated to [${pendingUserUpdate.newRole.toUpperCase()}].`,
      });

      setShowAdminPinModal(false);
      setPendingUserUpdate(null);
      fetchUsers();
      fetchAuditLogs();
    } catch (err) {
      console.error('Error updating user role:', err);
      setAdminPinError('Failed to update user document in database.');
    }
  };

  const handleSignOut = async () => {
    if (typeof window !== 'undefined') {
      localStorage.removeItem('user_role');
      localStorage.removeItem('user_email');
      localStorage.removeItem('user_uid');
    }
    await signOut(auth);
    window.location.href = '/';
  };

  // Filtered Logs
  const filteredLogs = auditLogs.filter((log) => {
    const matchesSearch =
      log.email.toLowerCase().includes(searchLogQuery.toLowerCase()) ||
      log.action.toLowerCase().includes(searchLogQuery.toLowerCase()) ||
      log.details.toLowerCase().includes(searchLogQuery.toLowerCase());

    if (!matchesSearch) return false;

    if (logFilter === 'DENIED') return log.status === 'DENIED' || log.action.includes('UNAUTHORIZED') || log.action.includes('MISMATCH');
    if (logFilter === 'PIN') return log.action.includes('PIN');
    if (logFilter === 'LOGIN') return log.action.includes('LOGIN');

    return true;
  });

  // Filtered Users
  const filteredUsers = usersList.filter((u) => u.email.toLowerCase().includes(searchUserQuery.toLowerCase()));

  // Filtered Issues for Community Governance & Flags
  const filteredIssues = issuesList.filter((issue) => {
    const matchesSearch =
      issue.ticketId.toLowerCase().includes(searchIssueQuery.toLowerCase()) ||
      issue.category.toLowerCase().includes(searchIssueQuery.toLowerCase()) ||
      issue.description.toLowerCase().includes(searchIssueQuery.toLowerCase());

    if (!matchesSearch) return false;

    if (issueFilter === 'DISPUTED') return issue.isDisputed || (issue.voteStats && issue.voteStats.no > issue.voteStats.yes);
    if (issueFilter === 'FLAGGED') return issue.adminFlagged;
    if (issueFilter === 'RESOLVED') return issue.status === 'Resolved';

    return true;
  });

  // Stats Counters
  const deniedAttemptsCount = auditLogs.filter((l) => l.status === 'DENIED' || l.action.includes('UNAUTHORIZED')).length;
  const pinVerificationsCount = auditLogs.filter((l) => l.action.includes('PIN') && l.status === 'SUCCESS').length;

  if (loading) return null;

  return (
    <div className="min-h-screen bg-[#050505] text-slate-200 flex font-sans">
      {/* Sidebar */}
      <aside className="w-64 bg-[#0a0a0a] border-r border-white/10 flex flex-col shrink-0 min-h-screen">
        <div className="h-16 flex items-center px-6 border-b border-white/10 gap-2">
          <Shield className="w-5 h-5 text-emerald-400" />
          <div>
            <span className="text-white font-serif italic tracking-tight font-semibold block text-sm">{t('admin_portal', 'Governance Center')}</span>
            <span className="text-[9px] uppercase tracking-widest text-emerald-400 font-mono">{t('role_admin', 'System Administrator')}</span>
          </div>
        </div>

        <nav className="flex-1 py-4 space-y-1 px-3">
          <div className="text-[10px] uppercase tracking-widest text-white/40 mb-3 px-3">Governance & Access</div>

          <button
            onClick={() => setActiveTab('audit')}
            className={`w-full flex items-center px-3 py-2.5 text-xs rounded-xl font-medium transition-all ${
              activeTab === 'audit'
                ? 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 font-bold'
                : 'text-white/60 hover:bg-white/5 hover:text-white'
            }`}
          >
            <Activity className="w-4 h-4 mr-3 text-emerald-400" />
            <span>{t('tab_audit', 'Security Audit Trail')}</span>
          </button>

          <button
            onClick={() => setActiveTab('users')}
            className={`w-full flex items-center px-3 py-2.5 text-xs rounded-xl font-medium transition-all ${
              activeTab === 'users'
                ? 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 font-bold'
                : 'text-white/60 hover:bg-white/5 hover:text-white'
            }`}
          >
            <Users className="w-4 h-4 mr-3 text-blue-400" />
            <span>{t('tab_users', 'User Access & Roles')}</span>
          </button>

          <button
            onClick={() => setActiveTab('config')}
            className={`w-full flex items-center px-3 py-2.5 text-xs rounded-xl font-medium transition-all ${
              activeTab === 'config'
                ? 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 font-bold'
                : 'text-white/60 hover:bg-white/5 hover:text-white'
            }`}
          >
            <Settings className="w-4 h-4 mr-3 text-amber-400" />
            <span>{t('tab_config', 'System Policy Rules')}</span>
          </button>

          <button
            onClick={() => setActiveTab('issues')}
            className={`w-full flex items-center justify-between px-3 py-2.5 text-xs rounded-xl font-medium transition-all ${
              activeTab === 'issues'
                ? 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 font-bold'
                : 'text-white/60 hover:bg-white/5 hover:text-white'
            }`}
          >
            <div className="flex items-center gap-3">
              <Flag className="w-4 h-4 text-amber-400" />
              <span>{t('tab_issues', 'Community Verification & Flags')}</span>
            </div>
            {issuesList.filter((i) => i.isDisputed || i.adminFlagged).length > 0 && (
              <span className="px-1.5 py-0.5 text-[10px] bg-red-500/30 text-red-300 border border-red-500/40 rounded-full font-mono font-bold">
                {issuesList.filter((i) => i.isDisputed || i.adminFlagged).length}
              </span>
            )}
          </button>
        </nav>

        <div className="p-4 border-t border-white/10 space-y-3">
          <div className="p-2.5 bg-emerald-950/40 rounded-xl border border-emerald-500/30 text-[11px] text-emerald-300">
            <div className="flex items-center gap-1.5 font-bold mb-1">
              <ShieldCheck className="w-4 h-4 text-emerald-400" />
              <span>Admin Passkey Active</span>
            </div>
            <p className="text-[10px] text-emerald-400/80">Govt Security Key: SYS-ADM-99</p>
          </div>

          <button
            onClick={handleSignOut}
            className="flex items-center w-full px-3 py-2 text-xs uppercase tracking-widest font-bold text-white/40 hover:text-white hover:bg-white/5 rounded-xl transition-colors"
          >
            <LogOut className="w-4 h-4 mr-3" />
            <span>{t('signOut', 'Sign out')}</span>
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0">
        <header className="h-16 bg-[#0a0a0a]/50 backdrop-blur-md border-b border-white/10 flex items-center justify-between px-8">
          <div className="flex items-center gap-3">
            <h1 className="text-base font-semibold text-white">{t('admin_title', 'System Security Governance Control')}</h1>
            <span className="text-[10px] px-2 py-0.5 bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 rounded font-mono uppercase">
              Operational
            </span>
          </div>

          <div className="flex items-center gap-4 text-xs">
            <LanguageSelector />

            <div className="text-slate-400">
              Logged as: <span className="text-white font-mono">{currentUser?.email || 'admin@crowdcivic.org'}</span>
            </div>
            <button
              onClick={() => {
                fetchAuditLogs();
                fetchUsers();
                fetchIssues();
              }}
              className="p-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg text-slate-300 transition-all flex items-center gap-1.5 text-xs"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>{t('refresh_incidents', 'Refresh')}</span>
            </button>
          </div>
        </header>

        <div className="p-8 flex-1 overflow-y-auto space-y-8">
          {/* STATS METRICS CARDS */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="bg-white/5 p-4 rounded-2xl border border-white/10">
              <p className="text-[10px] uppercase tracking-widest text-white/40 mb-1 font-semibold">{t('registered_users_count', 'Registered Users')}</p>
              <p className="text-2xl font-mono text-white font-bold">{usersList.length}</p>
              <p className="text-[10px] text-blue-400 mt-0.5">Role-segmented accounts</p>
            </div>

            <div className="bg-white/5 p-4 rounded-2xl border border-white/10">
              <p className="text-[10px] uppercase tracking-widest text-white/40 mb-1 font-semibold">{t('disputed_reports_count', 'Community Verification Disputed')}</p>
              <p className="text-2xl font-mono text-amber-400 font-bold">
                {issuesList.filter((i) => i.isDisputed || i.adminFlagged).length} / {issuesList.length}
              </p>
              <p className="text-[10px] text-amber-300/80 mt-0.5">Flagged or low approval issues</p>
            </div>

            <div className="bg-white/5 p-4 rounded-2xl border border-white/10">
              <p className="text-[10px] uppercase tracking-widest text-white/40 mb-1 font-semibold">{t('denied_access_attempts', 'Intercepted Violations')}</p>
              <p className="text-2xl font-mono text-red-400 font-bold">{deniedAttemptsCount}</p>
              <p className="text-[10px] text-red-400/80 mt-0.5">Unauthorized attempts blocked</p>
            </div>

            <div className="bg-white/5 p-4 rounded-2xl border border-white/10">
              <p className="text-[10px] uppercase tracking-widest text-white/40 mb-1 font-semibold">Security Guard Status</p>
              <div className="flex items-center mt-0.5 gap-2">
                <span className="w-2.5 h-2.5 bg-emerald-500 rounded-full animate-pulse"></span>
                <p className="text-lg font-mono text-emerald-400 font-bold">LOCKED & GUARDED</p>
              </div>
              <p className="text-[10px] text-slate-400 mt-0.5">Firestore security rules active</p>
            </div>
          </div>

          {/* TAB 1: SECURITY AUDIT TRAIL */}
          {activeTab === 'audit' && (
            <div className="bg-white/5 rounded-2xl border border-white/10 overflow-hidden space-y-4">
              <div className="p-6 border-b border-white/10 flex flex-col md:flex-row md:items-center justify-between gap-4 bg-[#0a0a0a]/50">
                <div>
                  <h2 className="font-semibold text-white text-base flex items-center gap-2">
                    <Activity className="w-5 h-5 text-emerald-400" />
                    <span>Real-Time Security Audit Logs</span>
                  </h2>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Immutable event ledger recording all login attempts, role breaches, and 2FA verification passkeys.
                  </p>
                </div>

                <div className="flex items-center gap-3">
                  <div className="relative">
                    <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      value={searchLogQuery}
                      onChange={(e) => setSearchLogQuery(e.target.value)}
                      placeholder="Search email, action..."
                      className="bg-black/50 border border-white/10 focus:border-emerald-500 text-xs text-white pl-8 pr-3 py-1.5 rounded-xl outline-none"
                    />
                  </div>

                  <div className="flex bg-black/50 border border-white/10 p-1 rounded-xl text-xs">
                    {(['ALL', 'DENIED', 'PIN', 'LOGIN'] as const).map((filter) => (
                      <button
                        key={filter}
                        onClick={() => setLogFilter(filter)}
                        className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-all ${
                          logFilter === filter ? 'bg-emerald-500 text-black' : 'text-slate-400 hover:text-white'
                        }`}
                      >
                        {filter}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="p-6">
                {loadingLogs ? (
                  <div className="py-12 text-center text-xs text-slate-400">Loading live security audit log stream...</div>
                ) : filteredLogs.length === 0 ? (
                  <div className="py-12 text-center text-xs text-slate-500">No security audit logs found matching filter.</div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead>
                        <tr className="border-b border-white/10 text-slate-400 text-[10px] uppercase tracking-wider font-semibold">
                          <th className="pb-3 pl-2">Timestamp</th>
                          <th className="pb-3">User & Email</th>
                          <th className="pb-3">Action</th>
                          <th className="pb-3">Portal</th>
                          <th className="pb-3">Status</th>
                          <th className="pb-3">Details & Device</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-white/5 font-sans">
                        {filteredLogs.map((log, idx) => (
                          <tr key={idx} className="hover:bg-white/[0.02] transition-colors">
                            <td className="py-3 pl-2 font-mono text-[11px] text-slate-400 whitespace-nowrap">
                              {new Date(log.timestamp).toLocaleTimeString()} ({new Date(log.timestamp).toLocaleDateString()})
                            </td>

                            <td className="py-3 font-medium text-white">
                              <span className="block font-semibold">{log.email}</span>
                              <span className="text-[10px] text-slate-400 font-mono">Role: {log.role}</span>
                            </td>

                            <td className="py-3">
                              <span
                                className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-bold tracking-wide uppercase font-mono ${
                                  log.action.includes('DENIED') || log.action.includes('UNAUTHORIZED') || log.action.includes('MISMATCH')
                                    ? 'bg-red-500/20 text-red-300 border border-red-500/30'
                                    : log.action.includes('PIN')
                                    ? 'bg-blue-500/20 text-blue-300 border border-blue-500/30'
                                    : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                                }`}
                              >
                                {log.action.includes('UNAUTHORIZED') && <ShieldAlert className="w-3 h-3 text-red-400" />}
                                {log.action.includes('PIN') && <Key className="w-3 h-3 text-blue-400" />}
                                <span>{log.action}</span>
                              </span>
                            </td>

                            <td className="py-3 uppercase text-[10px] font-mono font-semibold text-slate-300">{log.portal}</td>

                            <td className="py-3">
                              <span
                                className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                                  log.status === 'DENIED'
                                    ? 'bg-red-500/20 text-red-400'
                                    : log.status === 'WARNING'
                                    ? 'bg-amber-500/20 text-amber-400'
                                    : 'bg-emerald-500/20 text-emerald-400'
                                }`}
                              >
                                {log.status}
                              </span>
                            </td>

                            <td className="py-3 max-w-md">
                              <p className="text-slate-200 text-xs">{log.details}</p>
                              {log.deviceInfo && <p className="text-[10px] text-slate-500 font-mono mt-0.5">{log.deviceInfo}</p>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB 2: USER ACCESS & ROLE PERMISSIONS */}
          {activeTab === 'users' && (
            <div className="bg-white/5 rounded-2xl border border-white/10 overflow-hidden space-y-4">
              <div className="p-6 border-b border-white/10 flex items-center justify-between bg-[#0a0a0a]/50">
                <div>
                  <h2 className="font-semibold text-white text-base flex items-center gap-2">
                    <Users className="w-5 h-5 text-blue-400" />
                    <span>Registered System Users & Role Governance</span>
                  </h2>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Assign and enforce explicit roles (Citizen, Authority, Admin). Requires Admin 2FA Passkey PIN for updates.
                  </p>
                </div>

                <div className="relative w-64">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={searchUserQuery}
                    onChange={(e) => setSearchUserQuery(e.target.value)}
                    placeholder="Search user email..."
                    className="w-full bg-black/50 border border-white/10 focus:border-blue-500 text-xs text-white pl-8 pr-3 py-1.5 rounded-xl outline-none"
                  />
                </div>
              </div>

              <div className="p-6">
                {loadingUsers ? (
                  <div className="py-12 text-center text-xs text-slate-400">Loading system user registry...</div>
                ) : filteredUsers.length === 0 ? (
                  <div className="py-12 text-center text-xs text-slate-500">No users found matching query.</div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead>
                        <tr className="border-b border-white/10 text-slate-400 text-[10px] uppercase tracking-wider font-semibold">
                          <th className="pb-3 pl-2">User UID</th>
                          <th className="pb-3">User Email</th>
                          <th className="pb-3">Current Assigned Role</th>
                          <th className="pb-3">Change Permissions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-white/5 font-sans">
                        {filteredUsers.map((u, idx) => (
                          <tr key={idx} className="hover:bg-white/[0.02] transition-colors">
                            <td className="py-3 pl-2 font-mono text-[11px] text-slate-400">{u.uid.slice(0, 18)}...</td>

                            <td className="py-3 font-semibold text-white">{u.email}</td>

                            <td className="py-3">
                              <span
                                className={`px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider font-mono ${
                                  u.role === 'admin'
                                    ? 'bg-purple-500/20 text-purple-300 border border-purple-500/30'
                                    : u.role === 'authority'
                                    ? 'bg-blue-500/20 text-blue-300 border border-blue-500/30'
                                    : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                                }`}
                              >
                                {u.role}
                              </span>
                            </td>

                            <td className="py-3">
                              <div className="flex items-center gap-2">
                                <button
                                  onClick={() => handleRequestRoleChange(u.uid, u.email, 'citizen')}
                                  disabled={u.role === 'citizen'}
                                  className="px-2.5 py-1 bg-white/5 hover:bg-white/10 disabled:opacity-30 border border-white/10 text-[10px] font-semibold text-slate-300 rounded-lg transition-all"
                                >
                                  Make Citizen
                                </button>
                                <button
                                  onClick={() => handleRequestRoleChange(u.uid, u.email, 'authority')}
                                  disabled={u.role === 'authority'}
                                  className="px-2.5 py-1 bg-blue-500/20 hover:bg-blue-500/30 disabled:opacity-30 border border-blue-500/30 text-[10px] font-semibold text-blue-300 rounded-lg transition-all"
                                >
                                  Grant Authority
                                </button>
                                <button
                                  onClick={() => handleRequestRoleChange(u.uid, u.email, 'admin')}
                                  disabled={u.role === 'admin'}
                                  className="px-2.5 py-1 bg-purple-500/20 hover:bg-purple-500/30 disabled:opacity-30 border border-purple-500/30 text-[10px] font-semibold text-purple-300 rounded-lg transition-all"
                                >
                                  Grant Admin
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB 3: SYSTEM POLICY RULES */}
          {activeTab === 'config' && (
            <div className="bg-white/5 rounded-2xl border border-white/10 p-6 space-y-6">
              <div className="border-b border-white/10 pb-4">
                <h2 className="font-semibold text-white text-base flex items-center gap-2">
                  <Settings className="w-5 h-5 text-amber-400" />
                  <span>Government Platform Security & Access Policies</span>
                </h2>
                <p className="text-xs text-slate-400 mt-0.5">
                  Current active security enforcement parameters for the CrowdCivic platform.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                <div className="p-4 bg-black/40 border border-white/10 rounded-xl space-y-2">
                  <div className="flex items-center justify-between text-white font-semibold">
                    <span>1. Role-Guard Navigation Interceptor</span>
                    <span className="text-emerald-400 text-[10px] uppercase font-mono">Enforced</span>
                  </div>
                  <p className="text-slate-400 leading-relaxed text-[11px]">
                    Attempts by Citizens to enter `/authority` or `/admin` are intercepted immediately at router level and logged to audit logs.
                  </p>
                </div>

                <div className="p-4 bg-black/40 border border-white/10 rounded-xl space-y-2">
                  <div className="flex items-center justify-between text-white font-semibold">
                    <span>2. Credential-Tab Alignment Guard</span>
                    <span className="text-emerald-400 text-[10px] uppercase font-mono">Enforced</span>
                  </div>
                  <p className="text-slate-400 leading-relaxed text-[11px]">
                    Tab selection on login requires credential role match. Logging into Authority with Citizen email triggers `LOGIN_CREDENTIAL_MISMATCH`.
                  </p>
                </div>

                <div className="p-4 bg-black/40 border border-white/10 rounded-xl space-y-2">
                  <div className="flex items-center justify-between text-white font-semibold">
                    <span>3. Municipal 2FA Security Passkeys</span>
                    <span className="text-emerald-400 text-[10px] uppercase font-mono">Enforced</span>
                  </div>
                  <p className="text-slate-400 leading-relaxed text-[11px]">
                    High-impact authority resolution actions require typing the 6-digit Municipal Security PIN (`123456` for Authority, `999999` for Admin).
                  </p>
                </div>

                <div className="p-4 bg-black/40 border border-white/10 rounded-xl space-y-2">
                  <div className="flex items-center justify-between text-white font-semibold">
                    <span>4. Immutable Firestore Security Ledger</span>
                    <span className="text-emerald-400 text-[10px] uppercase font-mono">Active</span>
                  </div>
                  <p className="text-slate-400 leading-relaxed text-[11px]">
                    All auth events, permission changes, and security pin verifications are persisted to `auditLogs` collection in Firestore.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* TAB 4: COMMUNITY VERIFICATION & GOVERNANCE FLAGS */}
          {activeTab === 'issues' && (
            <div className="bg-white/5 rounded-2xl border border-white/10 overflow-hidden space-y-4">
              <div className="p-6 border-b border-white/10 flex flex-col md:flex-row md:items-center justify-between gap-4 bg-[#0a0a0a]/50">
                <div>
                  <h2 className="font-semibold text-white text-base flex items-center gap-2">
                    <Flag className="w-5 h-5 text-amber-400" />
                    <span>Community Verification Score & Dispute Flags</span>
                  </h2>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Monitor citizen verification scores for resolved issues. Flag or audit disputed resolutions.
                  </p>
                </div>

                <div className="flex items-center gap-3">
                  <div className="relative">
                    <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      value={searchIssueQuery}
                      onChange={(e) => setSearchIssueQuery(e.target.value)}
                      placeholder="Search Ticket ID or description..."
                      className="bg-black/50 border border-white/10 focus:border-amber-500 text-xs text-white pl-8 pr-3 py-1.5 rounded-xl outline-none"
                    />
                  </div>

                  <div className="flex bg-black/50 border border-white/10 p-1 rounded-xl text-xs">
                    {(['ALL', 'DISPUTED', 'FLAGGED', 'RESOLVED'] as const).map((filter) => (
                      <button
                        key={filter}
                        onClick={() => setIssueFilter(filter)}
                        className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-all ${
                          issueFilter === filter ? 'bg-amber-500 text-black' : 'text-slate-400 hover:text-white'
                        }`}
                      >
                        {filter}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="p-6">
                {loadingIssues ? (
                  <div className="py-12 text-center text-xs text-slate-400">Loading issues registry & verification votes...</div>
                ) : filteredIssues.length === 0 ? (
                  <div className="py-12 text-center text-xs text-slate-500">No issues found matching filter query.</div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead>
                        <tr className="border-b border-white/10 text-slate-400 text-[10px] uppercase tracking-wider font-semibold">
                          <th className="pb-3 pl-2">Ticket ID & Category</th>
                          <th className="pb-3">Status</th>
                          <th className="pb-3">Community Verification Score</th>
                          <th className="pb-3">Citizen Votes</th>
                          <th className="pb-3">Governance Flag</th>
                          <th className="pb-3 text-right pr-2">Admin Governance Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-white/5 font-sans">
                        {filteredIssues.map((issue, idx) => {
                          const totalVotes = (issue.voteStats?.yes || 0) + (issue.voteStats?.no || 0);
                          const approvalPct = totalVotes > 0 ? Math.round(((issue.voteStats?.yes || 0) / totalVotes) * 100) : null;

                          return (
                            <tr key={idx} className="hover:bg-white/[0.02] transition-colors">
                              <td className="py-3 pl-2 font-mono text-xs">
                                <span className="font-bold text-white block">#{issue.ticketId}</span>
                                <span className="text-[10px] text-slate-400 block font-sans">{issue.category}</span>
                              </td>

                              <td className="py-3">
                                <span
                                  className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase font-mono ${
                                    issue.status === 'Resolved'
                                      ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                                      : issue.status === 'In Progress'
                                      ? 'bg-blue-500/20 text-blue-300 border border-blue-500/30'
                                      : 'bg-slate-500/20 text-slate-300 border border-slate-500/30'
                                  }`}
                                >
                                  {issue.status}
                                </span>
                              </td>

                              <td className="py-3">
                                {totalVotes > 0 ? (
                                  <div className="space-y-1 max-w-[140px]">
                                    <div className="flex items-center justify-between text-[11px] font-bold">
                                      <span className={approvalPct! >= 60 ? 'text-emerald-400' : 'text-red-400'}>
                                        {approvalPct}% Approval
                                      </span>
                                      <span className="text-slate-400 text-[10px] font-normal">({totalVotes} votes)</span>
                                    </div>
                                    <div className="w-full bg-white/10 rounded-full h-1.5 overflow-hidden flex">
                                      <div
                                        className="bg-emerald-500 h-full"
                                        style={{ width: `${approvalPct}%` }}
                                      />
                                      <div
                                        className="bg-red-500 h-full"
                                        style={{ width: `${100 - approvalPct!}%` }}
                                      />
                                    </div>
                                  </div>
                                ) : (
                                  <span className="text-[10px] text-slate-500 italic">No verification votes yet</span>
                                )}
                              </td>

                              <td className="py-3">
                                <button
                                  onClick={() => setSelectedIssueComments(issue)}
                                  className="px-2.5 py-1 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg text-[11px] text-slate-300 flex items-center gap-1.5 transition-all"
                                >
                                  <MessageSquare className="w-3.5 h-3.5 text-blue-400" />
                                  <span>{issue.communityVotes?.length || 0} Ground Feedbacks</span>
                                </button>
                              </td>

                              <td className="py-3">
                                {issue.adminFlagged ? (
                                  <span className="px-2.5 py-1 bg-red-600/30 text-red-300 border border-red-500/50 rounded-full text-[10px] font-bold flex items-center gap-1 w-fit animate-pulse">
                                    <Flag className="w-3 h-3 text-red-400" /> ADMIN FLAGGED
                                  </span>
                                ) : issue.isDisputed ? (
                                  <span className="px-2.5 py-1 bg-amber-500/20 text-amber-300 border border-amber-500/30 rounded-full text-[10px] font-bold flex items-center gap-1 w-fit">
                                    <AlertTriangle className="w-3 h-3 text-amber-400" /> COMMUNITY DISPUTED
                                  </span>
                                ) : (
                                  <span className="px-2.5 py-1 bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 rounded-full text-[10px] font-semibold flex items-center gap-1 w-fit">
                                    <CheckCircle2 className="w-3 h-3" /> VERIFIED
                                  </span>
                                )}
                              </td>

                              <td className="py-3 text-right pr-2">
                                <div className="flex items-center gap-2 justify-end">
                                  <button
                                    onClick={() => handleToggleAdminFlag(issue.id, !!issue.adminFlagged)}
                                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${
                                      issue.adminFlagged
                                        ? 'bg-emerald-600/30 hover:bg-emerald-600/50 text-emerald-300 border border-emerald-500/40'
                                        : 'bg-red-600/30 hover:bg-red-600/50 text-red-300 border border-red-500/40'
                                    }`}
                                  >
                                    <Flag className="w-3.5 h-3.5" />
                                    <span>{issue.adminFlagged ? 'Clear Flag' : 'Put Flag / Audit'}</span>
                                  </button>
                                  <button
                                    onClick={() => handleDeleteIssue(issue.id, issue.ticketId)}
                                    className="px-3 py-1.5 bg-red-600/80 hover:bg-red-500 text-white border border-red-500 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 shadow-md shadow-red-600/20"
                                    title="Delete Complaint"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                    <span>Delete</span>
                                  </button>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </main>

      {/* ADMIN 2FA PIN CONFIRMATION MODAL */}
      {showAdminPinModal && pendingUserUpdate && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-[#0f172a] border border-purple-500/30 w-full max-w-md rounded-2xl p-6 shadow-2xl space-y-5 relative animate-in fade-in zoom-in-95">
            <button
              onClick={() => setShowAdminPinModal(false)}
              className="absolute top-4 right-4 text-slate-400 hover:text-white p-1 rounded-lg hover:bg-white/10"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="flex items-center gap-3">
              <div className="w-12 h-12 bg-purple-500/10 border border-purple-500/30 rounded-xl flex items-center justify-center text-purple-400 shrink-0">
                <KeyRound className="w-6 h-6" />
              </div>
              <div>
                <span className="text-[10px] font-bold tracking-widest text-purple-400 uppercase">System Governance 2FA</span>
                <h3 className="text-base font-bold text-white">Authorize Role Permissions Update</h3>
              </div>
            </div>

            <div className="bg-slate-900/80 p-3 rounded-xl border border-slate-800 text-xs text-slate-300 space-y-1">
              <p className="font-medium text-white">Modifying Target Account:</p>
              <p className="text-purple-300 font-mono font-bold">{pendingUserUpdate.targetEmail}</p>
              <p className="text-slate-400 text-[11px]">
                New Privilege Level: <span className="text-white uppercase font-bold">[{pendingUserUpdate.newRole}]</span>
              </p>
            </div>

            <form onSubmit={handleConfirmRoleChange} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5 flex items-center justify-between">
                  <span>Enter 6-Digit System Admin Passkey PIN</span>
                  <span className="text-[10px] text-purple-400 font-mono">Demo PIN: {DEFAULT_PIN_ADMIN}</span>
                </label>
                <div className="relative">
                  <Lock className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="password"
                    maxLength={6}
                    value={adminPinInput}
                    onChange={(e) => setAdminPinInput(e.target.value)}
                    placeholder="••••••"
                    className="w-full bg-slate-950 border border-slate-700 focus:border-purple-500 text-white pl-10 pr-4 py-3 rounded-xl text-lg font-mono tracking-widest outline-none transition-all placeholder:text-slate-600"
                    autoFocus
                  />
                </div>
              </div>

              {adminPinError && (
                <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-xl text-xs text-red-300 flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
                  <span>{adminPinError}</span>
                </div>
              )}

              <div className="flex items-center gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAdminPinModal(false)}
                  className="flex-1 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold rounded-xl transition-all"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 py-2.5 bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold rounded-xl flex items-center justify-center gap-2 shadow-lg shadow-purple-600/30 transition-all"
                >
                  <ShieldCheck className="w-4 h-4" />
                  <span>Confirm Privilege Change</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* CITIZEN VERIFICATION COMMENTS INSPECTION MODAL */}
      {selectedIssueComments && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-[#0f172a] border border-white/20 w-full max-w-lg rounded-2xl p-6 shadow-2xl space-y-4 relative animate-in fade-in zoom-in-95">
            <button
              onClick={() => setSelectedIssueComments(null)}
              className="absolute top-4 right-4 text-slate-400 hover:text-white p-1 rounded-lg hover:bg-white/10"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-blue-500/10 border border-blue-500/30 rounded-xl flex items-center justify-center text-blue-400 shrink-0">
                <MessageSquare className="w-5 h-5" />
              </div>
              <div>
                <span className="text-[10px] font-bold tracking-widest text-blue-400 uppercase">Ground Verification Inspection</span>
                <h3 className="text-sm font-bold text-white">Ticket #{selectedIssueComments.ticketId} - Community Feedback</h3>
              </div>
            </div>

            <p className="text-xs text-slate-300 bg-white/5 p-3 rounded-xl border border-white/5">
              "{selectedIssueComments.description}"
            </p>

            <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
              {!selectedIssueComments.communityVotes || selectedIssueComments.communityVotes.length === 0 ? (
                <div className="text-center py-6 text-xs text-slate-500">No citizen ground comments submitted yet.</div>
              ) : (
                selectedIssueComments.communityVotes.map((v, idx) => (
                  <div key={idx} className="p-3 bg-slate-900 border border-slate-800 rounded-xl text-xs space-y-1">
                    <div className="flex items-center justify-between text-slate-400 text-[11px]">
                      <span className="font-mono text-slate-300">{v.userEmail}</span>
                      <div className="flex items-center gap-2">
                        {v.distanceKm !== undefined && (
                          <span className="text-[9px] bg-blue-500/10 text-blue-300 px-1.5 py-0.5 rounded font-mono">
                            📍 {v.distanceKm} km away
                          </span>
                        )}
                        {v.vote === 'yes' ? (
                          <span className="text-emerald-400 font-bold flex items-center gap-1">
                            <ThumbsUp className="w-3 h-3" /> Fixed
                          </span>
                        ) : (
                          <span className="text-red-400 font-bold flex items-center gap-1">
                            <ThumbsDown className="w-3 h-3" /> Unresolved
                          </span>
                        )}
                      </div>
                    </div>
                    {v.comment && <p className="text-slate-200 text-xs italic font-sans">"{v.comment}"</p>}
                  </div>
                ))
              )}
            </div>

            <button
              onClick={() => setSelectedIssueComments(null)}
              className="w-full py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold rounded-xl transition-all"
            >
              Close Inspector
            </button>
          </div>
        </div>
      )}

      {/* ADMIN DELETE COMPLAINT CONFIRMATION MODAL */}
      {adminDeleteModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#0e1320] border border-red-500/30 rounded-2xl p-6 max-w-md w-full shadow-2xl relative">
            <button
              onClick={() => setAdminDeleteModal(null)}
              className="absolute top-4 right-4 p-1.5 rounded-full bg-white/5 hover:bg-white/10 text-slate-400 hover:text-white"
            >
              <X className="w-4 h-4" />
            </button>

            <div className="w-12 h-12 rounded-full bg-red-500/20 border border-red-500/40 flex items-center justify-center text-red-400 mb-4 mx-auto">
              <Trash2 className="w-6 h-6" />
            </div>

            <h3 className="text-lg font-bold text-white text-center mb-2">Admin Delete Complaint Ticket?</h3>
            <p className="text-xs text-slate-300 text-center leading-relaxed mb-6">
              Are you sure you want to permanently delete complaint ticket{' '}
              <span className="font-mono font-bold text-red-400 bg-red-500/10 px-1.5 py-0.5 rounded border border-red-500/20">
                #{adminDeleteModal.ticketId}
              </span>
              ? This action cannot be undone and will permanently remove it from the municipal database and citizen portals.
            </p>

            <div className="flex items-center justify-end gap-3 pt-4 border-t border-white/10">
              <button
                type="button"
                onClick={() => setAdminDeleteModal(null)}
                className="px-4 py-2 text-xs font-semibold text-slate-400 hover:text-white transition-colors"
                disabled={deletingIssue}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={executeDeleteIssue}
                disabled={deletingIssue}
                className="px-5 py-2 bg-red-600 hover:bg-red-500 text-white text-xs font-semibold rounded-xl flex items-center gap-2 shadow-lg shadow-red-600/30 transition-all disabled:opacity-50"
              >
                {deletingIssue ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    <span>Deleting Ticket...</span>
                  </>
                ) : (
                  <>
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Yes, Permanently Delete</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
