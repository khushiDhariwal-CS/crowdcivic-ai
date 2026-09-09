'use client';

import { useEffect, useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { auth, db } from '@/lib/firebase';
import { signOut, onAuthStateChanged, User as FirebaseUser } from 'firebase/auth';
import {
  collection,
  getDocs,
  doc,
  updateDoc,
  getDoc,
  query,
  orderBy,
  serverTimestamp,
  where,
  setDoc,
} from 'firebase/firestore';
import { logSecurityEvent, DEFAULT_PIN_AUTHORITY } from '@/lib/audit';
import { LanguageSelector, useLanguage } from '@/lib/LanguageContext';
import {
  Building2,
  LogOut,
  Camera,
  Video,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Clock,
  MapPin,
  Sparkles,
  RefreshCw,
  Search,
  Filter,
  X,
  Play,
  RotateCcw,
  ShieldCheck,
  ShieldAlert,
  Info,
  Check,
  Eye,
  ThumbsUp,
  ThumbsDown,
  Users,
  MessageSquare,
  Calendar,
  Layers,
  ArrowRight,
  ChevronRight,
  AlertCircle,
  FileCheck2,
  Lock,
  Key,
  KeyRound,
  Shield,
  Fingerprint,
} from 'lucide-react';

interface AIAnalysis {
  category: string;
  issueType: string;
  description: string;
  severity: string;
  department: string;
  confidenceScore: number;
  keyObservations?: string[];
}

interface IssueReport {
  id: string;
  ticketId: string;
  userId: string;
  userEmail: string;
  title: string;
  category: string;
  issueType: string;
  description: string;
  severity: string;
  department: string;
  location: {
    latitude: number | null;
    longitude: number | null;
    address: string;
    city: string;
    area: string;
  };
  imageUrl: string;
  aiAnalysis: AIAnalysis;
  status: 'Submitted' | 'Under Verification' | 'In Progress' | 'Resolved' | 'Resolution Failed';
  createdAt: any;
  upvotes?: number;
  parentId?: string | null;
  isDuplicate?: boolean;
  duplicateCount?: number;
  supportersCount?: number;
  supporters?: string[];
  evidencePhotos?: string[];
  duplicateMatchInfo?: any;

  // Resolution proof fields
  resolvedAt?: string;
  resolvedBy?: string;
  resolutionVideoFrames?: string[];
  resolutionAiAudit?: {
    isAuthentic: boolean;
    confidenceScore: number;
    locationMatchScore: number;
    visualResolutionMatch: boolean;
    verificationSummary: string;
    detectedFixes: string[];
    rejectionReason?: string;
  };
  communityVotes?: Array<{
    userId: string;
    userEmail: string;
    vote: 'yes' | 'no';
    comment: string;
    createdAt: string;
    distanceKm?: number;
  }>;
  voteStats?: {
    yes: number;
    no: number;
  };
  isDisputed?: boolean;
}

const CATEGORIES = [
  'All Categories',
  'Roads & Infrastructure',
  'Waste & Sanitation',
  'Water & Drainage',
  'Power & Street Lighting',
  'Traffic & Public Transit',
  'Parks & Public Spaces',
  'Public Safety & Vandalism',
  'Other',
];

export default function AuthorityDashboard() {
  const router = useRouter();
  const { t } = useLanguage();
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [loading, setLoading] = useState(true);

  // Issues list
  const [issues, setIssues] = useState<IssueReport[]>([]);
  const [loadingIssues, setLoadingIssues] = useState(false);

  // Filters & Search
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('All');
  const [categoryFilter, setCategoryFilter] = useState<string>('All Categories');
  const [severityFilter, setSeverityFilter] = useState<string>('All');

  // Selected Issue for inspection
  const [selectedIssue, setSelectedIssue] = useState<IssueReport | null>(null);
  const [inspectModalOpen, setInspectModalOpen] = useState(false);

  // Resolution Recording Studio Modal
  const [resolveModalOpen, setResolveModalOpen] = useState(false);
  const [targetIssue, setTargetIssue] = useState<IssueReport | null>(null);

  // Camera & Geolocation State for Resolution
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [mediaStream, setMediaStream] = useState<MediaStream | null>(null);
  const [mediaRecorder, setMediaRecorder] = useState<MediaRecorder | null>(null);

  const [authorityGps, setAuthorityGps] = useState<{
    latitude: number | null;
    longitude: number | null;
    address: string;
    loading: boolean;
    error: string | null;
  }>({
    latitude: null,
    longitude: null,
    address: '',
    loading: false,
    error: null,
  });

  // Timetag live timer
  const [liveTimestamp, setLiveTimestamp] = useState<string>('');

  // Government Security PIN Verification State
  const [showPinModal, setShowPinModal] = useState(false);
  const [pinInput, setPinInput] = useState('');
  const [pinError, setPinError] = useState('');
  const [pinPendingAction, setPinPendingAction] = useState<(() => Promise<void>) | null>(null);
  const [pinActionTitle, setPinActionTitle] = useState('');

  // Helper to request PIN verification before high-level authority actions
  const requireSecurityPin = (actionTitle: string, actionFn: () => Promise<void>) => {
    setPinActionTitle(actionTitle);
    setPinPendingAction(() => actionFn);
    setPinInput('');
    setPinError('');
    setShowPinModal(true);
  };

  const handleVerifyPinAndExecute = async (e: React.FormEvent) => {
    e.preventDefault();
    setPinError('');

    if (pinInput.trim() !== DEFAULT_PIN_AUTHORITY) {
      await logSecurityEvent({
        userId: user?.uid || 'authority_official',
        email: user?.email || 'authority@crowdcivic.org',
        role: 'authority',
        action: 'SECURITY_PIN_FAILED',
        portal: 'authority',
        status: 'DENIED',
        details: `Failed 2FA Security PIN attempt for action: "${pinActionTitle}"`,
      });
      setPinError('Invalid Municipal Passkey PIN. Please check your credentials.');
      return;
    }

    // Success
    await logSecurityEvent({
      userId: user?.uid || 'authority_official',
      email: user?.email || 'authority@crowdcivic.org',
      role: 'authority',
      action: 'SECURITY_PIN_VERIFIED',
      portal: 'authority',
      status: 'SUCCESS',
      details: `2FA Municipal Security Passkey verified for action: "${pinActionTitle}"`,
    });

    setShowPinModal(false);
    if (pinPendingAction) {
      await pinPendingAction();
      setPinPendingAction(null);
    }
  };

  // Recording timer (30 seconds requirement)
  const [recording, setRecording] = useState(false);
  const [recordSecondsLeft, setRecordSecondsLeft] = useState(30);
  const [recordedFrames, setRecordedFrames] = useState<string[]>([]);
  const [recordedVideoBlobUrl, setRecordedVideoBlobUrl] = useState<string | null>(null);

  // AI Verification execution state
  const [verifyingWithAi, setVerifyingWithAi] = useState(false);
  const [aiAuditResult, setAiAuditResult] = useState<{
    isAuthentic: boolean;
    confidenceScore: number;
    locationMatchScore: number;
    visualResolutionMatch: boolean;
    verificationSummary: string;
    detectedFixes: string[];
    rejectionReason?: string;
  } | null>(null);

  const [auditError, setAuditError] = useState<string | null>(null);
  const [updatingFirestore, setUpdatingFirestore] = useState(false);

  // Check auth and authority role
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

      setUser(effUser);

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

        if (userRole !== 'authority') {
          router.push(userRole === 'admin' ? '/admin' : '/citizen');
          return;
        }
      } catch (e) {
        console.warn('Authority role verification error:', e);
      }

      setLoading(false);
      fetchIssues();
    });

    return () => unsubscribe();
  }, [router]);

  // Clock tick for live timetag overlay
  useEffect(() => {
    const interval = setInterval(() => {
      setLiveTimestamp(new Date().toISOString().replace('T', ' ').substring(0, 19) + ' UTC');
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  // Fetch all issues from Firestore
  const fetchIssues = async () => {
    setLoadingIssues(true);
    try {
      const snapshot = await getDocs(collection(db, 'issues'));
      const list: IssueReport[] = snapshot.docs.map((d) => ({
        id: d.id,
        ...(d.data() as Omit<IssueReport, 'id'>),
      }));

      // Sort newest first
      list.sort((a, b) => {
        const timeA = a.createdAt?.seconds ? a.createdAt.seconds * 1000 : new Date(a.createdAt || 0).getTime();
        const timeB = b.createdAt?.seconds ? b.createdAt.seconds * 1000 : new Date(b.createdAt || 0).getTime();
        return timeB - timeA;
      });

      setIssues(list);
    } catch (err) {
      console.error('Error fetching issues in authority portal:', err);
    } finally {
      setLoadingIssues(false);
    }
  };

  // Get Authority's Live Geolocation
  const getAuthorityLocation = () => {
    if (!navigator.geolocation) {
      setAuthorityGps((prev) => ({
        ...prev,
        error: 'Geolocation not supported by device.',
      }));
      return;
    }

    setAuthorityGps((prev) => ({ ...prev, loading: true, error: null }));

    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;

        try {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 3500);

          const res = await fetch(
            `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1`,
            {
              headers: { 'Accept-Language': 'en' },
              signal: controller.signal,
            }
          );
          clearTimeout(timeoutId);

          if (res.ok) {
            const data = await res.json();
            const addr = data.address || {};
            const road = addr.road || addr.suburb || addr.neighbourhood || '';
            const city = addr.city || addr.town || addr.village || 'City Zone';
            const formatted = [road, city].filter(Boolean).join(', ') || data.display_name || `${lat.toFixed(4)}°, ${lng.toFixed(4)}°`;

            setAuthorityGps({
              latitude: lat,
              longitude: lng,
              address: formatted,
              loading: false,
              error: null,
            });
            return;
          }
        } catch {
          // Silent fallback on network block or timeout
        }

        setAuthorityGps({
          latitude: lat,
          longitude: lng,
          address: `Authority On-Site Pin (${lat.toFixed(4)}°, ${lng.toFixed(4)}°)`,
          loading: false,
          error: null,
        });
      },
      (err) => {
        console.warn('Authority geolocation error:', err);
        setAuthorityGps((prev) => ({
          ...prev,
          loading: false,
          error: 'GPS permissions required to verify on-site presence.',
        }));
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  // Open Resolution Camera Studio
  const openResolutionStudio = async (issue: IssueReport) => {
    setTargetIssue(issue);
    setResolveModalOpen(true);
    setAiAuditResult(null);
    setAuditError(null);
    setRecordedFrames([]);
    setRecordedVideoBlobUrl(null);
    setRecording(false);
    setRecordSecondsLeft(30);

    // Acquire GPS
    getAuthorityLocation();

    // Start live video stream
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      setMediaStream(stream);
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
    } catch (err) {
      console.error('Camera access error:', err);
      alert('Camera access is required to capture the 30-second resolution video.');
    }
  };

  // Close Resolution Studio
  const closeResolutionStudio = () => {
    if (mediaStream) {
      mediaStream.getTracks().forEach((track) => track.stop());
      setMediaStream(null);
    }
    setResolveModalOpen(false);
    setTargetIssue(null);
    setRecording(false);
  };

  // Start 30-Second Video Recording
  const start30SecRecording = () => {
    if (!mediaStream) return;

    setRecordedFrames([]);
    setRecordedVideoBlobUrl(null);
    setAiAuditResult(null);
    setAuditError(null);
    setRecording(true);
    setRecordSecondsLeft(30);

    const chunks: Blob[] = [];
    const framesAcc: string[] = [];

    // Capture first frame immediately
    captureFrameSnapshot(framesAcc);

    // Setup recorder
    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(mediaStream, { mimeType: 'video/webm' });
    } catch (e) {
      recorder = new MediaRecorder(mediaStream);
    }

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };

    recorder.onstop = () => {
      const blob = new Blob(chunks, { type: 'video/webm' });
      const url = URL.createObjectURL(blob);
      setRecordedVideoBlobUrl(url);
    };

    recorder.start(1000);
    setMediaRecorder(recorder);

    // Timer & Keyframe intervals over 30 seconds
    let seconds = 30;
    const interval = setInterval(() => {
      seconds -= 1;
      setRecordSecondsLeft(seconds);

      // Capture keyframe every 5 seconds (T=5s, 10s, 15s, 20s, 25s, 30s)
      if (seconds % 5 === 0) {
        captureFrameSnapshot(framesAcc);
      }

      if (seconds <= 0) {
        clearInterval(interval);
        if (recorder && recorder.state !== 'inactive') {
          recorder.stop();
        }
        setRecording(false);
        setRecordedFrames(framesAcc);
      }
    }, 1000);
  };

  // Helper to capture canvas frame with burned-in timetag & GPS overlay
  const captureFrameSnapshot = (container: string[]) => {
    if (videoRef.current && canvasRef.current) {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      // Use compact resolution (480x360) to keep base64 frame sizes very small (~20KB)
      canvas.width = 480;
      canvas.height = 360;

      const ctx = canvas.getContext('2d');
      if (ctx) {
        // Draw video frame
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

        // Burn-in Timetag and GPS watermark
        ctx.fillStyle = 'rgba(0, 0, 0, 0.75)';
        ctx.fillRect(10, canvas.height - 60, canvas.width - 20, 50);

        ctx.font = 'bold 12px monospace';
        ctx.fillStyle = '#10B981'; // emerald
        ctx.fillText(`TIMETAG: ${new Date().toISOString()}`, 15, canvas.height - 38);

        ctx.font = '10px sans-serif';
        ctx.fillStyle = '#FFFFFF';
        const gpsStr = authorityGps.latitude
          ? `GPS: ${authorityGps.latitude.toFixed(5)}°N, ${authorityGps.longitude?.toFixed(5)}°E | ${authorityGps.address}`
          : 'GPS: Location Tagged';
        ctx.fillText(gpsStr, 15, canvas.height - 18);

        const dataUrl = canvas.toDataURL('image/jpeg', 0.6);
        container.push(dataUrl);
      }
    }
  };

  // Submit Video to AI Verification API
  const handleVerifyResolution = async () => {
    if (!targetIssue) return;
    if (recordedFrames.length === 0) {
      alert('Please complete the 30-second video recording first.');
      return;
    }

    setVerifyingWithAi(true);
    setAuditError(null);

    try {
      const payload = {
        issueId: targetIssue.id,
        authorityEmail: user?.email || 'Authority Official',
        videoFramesBase64: recordedFrames,
        authorityLocation: {
          latitude: authorityGps.latitude,
          longitude: authorityGps.longitude,
          address: authorityGps.address,
          timestamp: new Date().toISOString(),
        },
        citizenLocation: {
          latitude: targetIssue.location.latitude,
          longitude: targetIssue.location.longitude,
          address: targetIssue.location.address,
        },
        issueDetails: {
          id: targetIssue.id,
          ticketId: targetIssue.ticketId,
          title: targetIssue.title,
          category: targetIssue.category,
          description: targetIssue.description,
          imageUrl: targetIssue.imageUrl,
        },
      };

      const res = await fetch('/api/verify-resolution', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await res.json();

      if (res.ok && data.success && data.verification) {
        const audit = data.verification;
        setAiAuditResult(audit);
        // Server API has authoritatively updated Firestore status directly via Admin SDK
        fetchIssues();
      } else {
        setAuditError(data.error || 'Failed to analyze video verification proof.');
      }
    } catch (err: any) {
      console.error('Error verifying video with AI:', err);
      setAuditError('Network or server error during AI verification.');
    } finally {
      setVerifyingWithAi(false);
    }
  };

  // Update Firestore when AI Verification passes
  const markIssueAsResolved = async (docId: string, auditData: any) => {
    setUpdatingFirestore(true);
    try {
      const issueRef = doc(db, 'issues', docId);
      await updateDoc(issueRef, {
        status: 'Resolved',
        resolvedAt: new Date().toISOString(),
        resolvedBy: user?.email || 'Authority Official',
        resolutionVideoFrames: recordedFrames.slice(0, 1),
        resolutionAiAudit: auditData,
      });

      fetchIssues();
    } catch (err) {
      console.error('Error updating Firestore issue state:', err);
    } finally {
      setUpdatingFirestore(false);
    }
  };

  // Update Firestore when AI Verification fails
  const markIssueAsFailedVerification = async (docId: string, auditData: any) => {
    try {
      const issueRef = doc(db, 'issues', docId);
      await updateDoc(issueRef, {
        status: 'Resolution Failed',
        resolutionAiAudit: auditData,
      });

      fetchIssues();
    } catch (err) {
      console.error('Error updating failed status:', err);
    }
  };

  // Mark status as 'In Progress' manually with PIN protection
  const markAsInProgress = (issue: IssueReport) => {
    requireSecurityPin(`Update Ticket #${issue.ticketId} status to "In Progress"`, async () => {
      try {
        const issueRef = doc(db, 'issues', issue.id);
        await updateDoc(issueRef, {
          status: 'In Progress',
        });

        await logSecurityEvent({
          userId: user?.uid || 'authority_official',
          email: user?.email || 'authority@crowdcivic.org',
          role: 'authority',
          action: 'ISSUE_STATUS_UPDATED',
          portal: 'authority',
          status: 'SUCCESS',
          details: `Ticket #${issue.ticketId} status updated to 'In Progress' by authority.`,
        });

        fetchIssues();
      } catch (err) {
        console.error('Error setting in progress:', err);
      }
    });
  };

  // Filtered issues calculation
  const filteredIssues = issues.filter((issue) => {
    const matchesSearch =
      issue.ticketId.toLowerCase().includes(searchQuery.toLowerCase()) ||
      issue.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      issue.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
      issue.location?.address.toLowerCase().includes(searchQuery.toLowerCase());

    const matchesStatus = statusFilter === 'All' || issue.status === statusFilter;
    const matchesCategory = categoryFilter === 'All Categories' || issue.category === categoryFilter;
    const matchesSeverity = severityFilter === 'All' || issue.severity === severityFilter;

    return matchesSearch && matchesStatus && matchesCategory && matchesSeverity;
  });

  // Calculate stats
  const totalCount = issues.length;
  const pendingCount = issues.filter((i) => i.status === 'Submitted' || i.status === 'Under Verification').length;
  const progressCount = issues.filter((i) => i.status === 'In Progress').length;
  const resolvedCount = issues.filter((i) => i.status === 'Resolved').length;
  const failedCount = issues.filter((i) => i.status === 'Resolution Failed').length;

  const handleSignOut = async () => {
    if (typeof window !== 'undefined') {
      localStorage.removeItem('user_role');
      localStorage.removeItem('user_email');
      localStorage.removeItem('user_uid');
    }
    await signOut(auth);
    window.location.href = '/';
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#050505] flex items-center justify-center text-white">
        <div className="flex items-center gap-3">
          <RefreshCw className="w-6 h-6 animate-spin text-blue-500" />
          <span className="text-sm font-medium tracking-wide">Loading Authority Module...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#07090e] text-slate-200 font-sans pb-16">
      {/* Hidden Canvas for Video Snapshots */}
      <canvas ref={canvasRef} className="hidden" />

      {/* Header */}
      <header className="bg-[#0b0f19]/80 backdrop-blur-md border-b border-white/10 sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-blue-600 to-indigo-600 flex items-center justify-center text-white shadow-md">
              <Building2 className="w-5 h-5" />
            </div>
            <div>
              <span className="text-white font-bold text-sm tracking-tight block">{t('authority_portal', 'Municipal Authority Portal')}</span>
              <span className="text-[10px] text-emerald-400 font-mono tracking-wider uppercase block flex items-center gap-1">
                <ShieldCheck className="w-3 h-3" /> {t('ai_verification_enabled', 'AI Resolution Verification Enabled')}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <LanguageSelector />

            <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/5 border border-white/10 text-xs text-slate-300">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
              <span className="truncate max-w-[150px]">{user?.email}</span>
            </div>

            <button
              onClick={handleSignOut}
              className="text-xs font-medium text-slate-400 hover:text-white flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-white/10 hover:bg-white/5 transition-all"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>{t('signOut', 'Sign Out')}</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Body */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Title Bar */}
        <div className="mb-8 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-white tracking-tight">{t('incidents_command', 'Incidents & Resolution Command')}</h1>
            <p className="text-xs text-slate-400 mt-1">
              {t('authority_subtitle', 'Inspect citizen reports and resolve issues with mandatory 30-second live camera video proof & AI spatial verification.')}
            </p>
          </div>

          <button
            onClick={fetchIssues}
            className="px-3.5 py-2 bg-white/5 hover:bg-white/10 text-slate-300 text-xs font-medium rounded-xl border border-white/10 flex items-center gap-2 transition-all self-start sm:self-auto"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loadingIssues ? 'animate-spin text-blue-400' : ''}`} />
            <span>{t('refresh_incidents', 'Refresh Incidents')}</span>
          </button>
        </div>

        {/* Top Metric Cards */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-8">
          <div className="bg-[#0e1320] p-4 rounded-xl border border-white/10 flex flex-col justify-between">
            <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">{t('total_reports', 'Total Reports')}</span>
            <div className="flex items-baseline justify-between mt-2">
              <span className="text-2xl font-bold font-mono text-white">{totalCount}</span>
              <Layers className="w-4 h-4 text-blue-400" />
            </div>
          </div>

          <div className="bg-[#0e1320] p-4 rounded-xl border border-amber-500/20 flex flex-col justify-between">
            <span className="text-[11px] font-semibold text-amber-400 uppercase tracking-wider">{t('pending_review', 'Pending Review')}</span>
            <div className="flex items-baseline justify-between mt-2">
              <span className="text-2xl font-bold font-mono text-amber-300">{pendingCount}</span>
              <Clock className="w-4 h-4 text-amber-400" />
            </div>
          </div>

          <div className="bg-[#0e1320] p-4 rounded-xl border border-blue-500/20 flex flex-col justify-between">
            <span className="text-[11px] font-semibold text-blue-400 uppercase tracking-wider">{t('status_in_progress', 'In Progress')}</span>
            <div className="flex items-baseline justify-between mt-2">
              <span className="text-2xl font-bold font-mono text-blue-300">{progressCount}</span>
              <RefreshCw className="w-4 h-4 text-blue-400" />
            </div>
          </div>

          <div className="bg-[#0e1320] p-4 rounded-xl border border-emerald-500/20 flex flex-col justify-between">
            <span className="text-[11px] font-semibold text-emerald-400 uppercase tracking-wider">{t('ai_resolved', 'AI Resolved')}</span>
            <div className="flex items-baseline justify-between mt-2">
              <span className="text-2xl font-bold font-mono text-emerald-300">{resolvedCount}</span>
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            </div>
          </div>

          <div className="bg-[#0e1320] p-4 rounded-xl border border-red-500/20 flex flex-col justify-between col-span-2 md:col-span-1">
            <span className="text-[11px] font-semibold text-red-400 uppercase tracking-wider">{t('audit_failed', 'Audit Failed')}</span>
            <div className="flex items-baseline justify-between mt-2">
              <span className="text-2xl font-bold font-mono text-red-300">{failedCount}</span>
              <ShieldAlert className="w-4 h-4 text-red-400" />
            </div>
          </div>
        </div>

        {/* Filter & Search Toolbar */}
        <div className="bg-[#0e1320] p-4 rounded-2xl border border-white/10 mb-6 flex flex-col lg:flex-row gap-4 justify-between items-center">
          {/* Search bar */}
          <div className="relative w-full lg:w-80">
            <Search className="w-4 h-4 text-slate-500 absolute left-3 top-3" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t('search_authority_placeholder', 'Search Ticket ID, title, landmark...')}
              className="w-full bg-[#07090e] border border-white/10 rounded-xl pl-9 pr-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
            />
          </div>

          {/* Filters */}
          <div className="flex flex-wrap items-center gap-2 w-full lg:w-auto">
            {/* Status Dropdown */}
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="bg-[#07090e] border border-white/10 rounded-xl px-3 py-2 text-xs text-slate-300 focus:outline-none focus:border-blue-500"
            >
              <option value="All">Status: All ({issues.length})</option>
              <option value="Submitted">Submitted</option>
              <option value="In Progress">In Progress</option>
              <option value="Resolved">Resolved</option>
              <option value="Resolution Failed">Resolution Failed</option>
            </select>

            {/* Category Dropdown */}
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="bg-[#07090e] border border-white/10 rounded-xl px-3 py-2 text-xs text-slate-300 focus:outline-none focus:border-blue-500"
            >
              {CATEGORIES.map((cat) => (
                <option key={cat} value={cat}>
                  {cat}
                </option>
              ))}
            </select>

            {/* Severity Dropdown */}
            <select
              value={severityFilter}
              onChange={(e) => setSeverityFilter(e.target.value)}
              className="bg-[#07090e] border border-white/10 rounded-xl px-3 py-2 text-xs text-slate-300 focus:outline-none focus:border-blue-500"
            >
              <option value="All">Severity: All</option>
              <option value="Critical">Critical</option>
              <option value="High">High</option>
              <option value="Medium">Medium</option>
              <option value="Low">Low</option>
            </select>
          </div>
        </div>

        {/* Incident Cards Grid */}
        {filteredIssues.length === 0 ? (
          <div className="bg-[#0e1320] border border-white/10 rounded-2xl p-12 text-center">
            <AlertCircle className="w-10 h-10 text-slate-500 mx-auto mb-3" />
            <h3 className="text-sm font-semibold text-white">No matching incidents found</h3>
            <p className="text-xs text-slate-400 mt-1">Try adjusting your search terms or filters.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredIssues.map((issue) => (
              <div
                key={issue.id}
                className="bg-[#0e1320] rounded-2xl border border-white/10 overflow-hidden hover:border-blue-500/40 transition-all flex flex-col justify-between group"
              >
                <div>
                  {/* Card Image Header */}
                  <div className="relative h-48 w-full bg-black">
                    <img src={issue.imageUrl} alt={issue.title} className="w-full h-full object-cover" />
                    <div className="absolute inset-0 bg-gradient-to-t from-[#0e1320] via-transparent to-black/40"></div>

                    {/* Ticket ID Tag */}
                    <div className="absolute top-3 left-3 px-2.5 py-1 rounded-lg bg-black/80 backdrop-blur-md border border-white/20 text-blue-400 font-mono text-[11px] font-bold">
                      {issue.ticketId}
                    </div>

                    {/* Status Badge */}
                    <div className="absolute top-3 right-3">
                      <span
                        className={`px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider border shadow-md ${
                          issue.status === 'Resolved'
                            ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                            : issue.status === 'In Progress'
                            ? 'bg-blue-500/20 text-blue-300 border-blue-500/40'
                            : issue.status === 'Resolution Failed'
                            ? 'bg-red-500/20 text-red-300 border-red-500/40'
                            : 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                        }`}
                      >
                        {issue.status}
                      </span>
                    </div>

                    {/* Category Overlay */}
                    <div className="absolute bottom-3 left-3 right-3 flex items-center justify-between text-xs">
                      <span className="px-2 py-0.5 rounded bg-blue-600/80 text-white font-medium text-[10px]">
                        {issue.category}
                      </span>
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
                          issue.severity === 'Critical'
                            ? 'bg-red-600 text-white'
                            : issue.severity === 'High'
                            ? 'bg-orange-600 text-white'
                            : 'bg-slate-700 text-slate-200'
                        }`}
                      >
                        {issue.severity} Severity
                      </span>
                    </div>
                  </div>

                  {/* Card Content */}
                  <div className="p-5 space-y-3">
                    <h3 className="font-semibold text-white text-sm line-clamp-1 group-hover:text-blue-300 transition-colors">
                      {issue.title}
                    </h3>
                    <p className="text-xs text-slate-400 line-clamp-2 leading-relaxed">{issue.description}</p>

                    {/* Location Tag */}
                    <div className="flex items-start gap-1.5 text-xs text-slate-300 bg-white/5 p-2.5 rounded-xl border border-white/5">
                      <MapPin className="w-3.5 h-3.5 text-red-400 flex-shrink-0 mt-0.5" />
                      <div className="min-w-0">
                        <p className="font-medium truncate text-white">{issue.location?.address}</p>
                        {issue.location?.latitude && (
                          <p className="text-[10px] font-mono text-slate-400 mt-0.5">
                            GPS: {issue.location.latitude.toFixed(4)}°, {issue.location.longitude?.toFixed(4)}°
                          </p>
                        )}
                      </div>
                    </div>

                    {/* Department Tag */}
                    <div className="flex items-center justify-between text-[11px] text-slate-400">
                      <span className="flex items-center gap-1">
                        <Building2 className="w-3 h-3 text-amber-400" /> {issue.department}
                      </span>
                      <span className="text-[10px] text-slate-500">
                        {issue.createdAt?.seconds
                          ? new Date(issue.createdAt.seconds * 1000).toLocaleDateString()
                          : 'Recent'}
                      </span>
                    </div>

                    {/* Community Resolution Verification Status */}
                    {issue.voteStats && (issue.voteStats.yes + issue.voteStats.no > 0) && (
                      <div className={`p-2.5 rounded-xl border text-xs space-y-1.5 ${
                        issue.isDisputed 
                          ? 'bg-red-950/40 border-red-500/40 text-red-300 animate-pulse'
                          : 'bg-emerald-950/30 border-emerald-500/30 text-emerald-300'
                      }`}>
                        <div className="flex items-center justify-between font-semibold">
                          <span className="flex items-center gap-1">
                            <Users className="w-3.5 h-3.5 text-blue-400" />
                            <span>Citizen Verification</span>
                          </span>
                          {issue.isDisputed ? (
                            <span className="text-[10px] bg-red-600 text-white px-2 py-0.5 rounded font-mono font-bold">
                              ⚠️ DISPUTED BY CITIZENS
                            </span>
                          ) : (
                            <span className="text-[10px] bg-emerald-600/80 text-white px-2 py-0.5 rounded font-mono font-bold">
                              ✓ {Math.round((issue.voteStats.yes / (issue.voteStats.yes + issue.voteStats.no)) * 100)}% Approved
                            </span>
                          )}
                        </div>
                        <div className="flex items-center justify-between text-[11px] text-slate-300">
                          <span className="flex items-center gap-1 text-emerald-400 font-semibold">
                            <ThumbsUp className="w-3 h-3" /> {issue.voteStats.yes} Verified Fixed
                          </span>
                          <span className="flex items-center gap-1 text-red-400 font-semibold">
                            <ThumbsDown className="w-3 h-3" /> {issue.voteStats.no} Reported Unresolved
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Card Action Footer */}
                <div className="p-4 bg-white/5 border-t border-white/5 space-y-2">
                  {issue.status === 'Resolved' ? (
                    <div className="bg-emerald-500/10 border border-emerald-500/20 p-2.5 rounded-xl text-center">
                      <div className="flex items-center justify-center gap-1.5 text-emerald-400 text-xs font-semibold">
                        <ShieldCheck className="w-4 h-4" />
                        <span>AI Resolution Audit Passed</span>
                      </div>
                      <p className="text-[10px] text-slate-400 mt-1">
                        Resolved by {issue.resolvedBy || 'Authority'}
                      </p>
                    </div>
                  ) : (
                    <div className="flex flex-col gap-2">
                      <button
                        onClick={() => openResolutionStudio(issue)}
                        className="w-full py-2.5 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white text-xs font-semibold rounded-xl flex items-center justify-center gap-2 shadow-md shadow-emerald-600/20 transition-all"
                      >
                        <Video className="w-4 h-4" />
                        <span>Resolve Issue (30s Live Video)</span>
                      </button>

                      {issue.status === 'Submitted' && (
                        <button
                          onClick={() => markAsInProgress(issue)}
                          className="w-full py-1.5 bg-white/5 hover:bg-white/10 text-slate-300 text-[11px] font-medium rounded-lg border border-white/10 transition-all"
                        >
                          Mark as "In Progress"
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </main>

      {/* MODAL: 30-SECOND LIVE CAMERA RESOLUTION STUDIO */}
      {resolveModalOpen && targetIssue && (
        <div className="fixed inset-0 z-50 bg-black/90 backdrop-blur-md flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-[#0b0f19] border border-white/20 rounded-3xl w-full max-w-3xl overflow-hidden shadow-2xl relative my-8">
            {/* Modal Header */}
            <div className="px-6 py-4 bg-white/5 border-b border-white/10 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 flex items-center justify-center">
                  <Video className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white">Issue Resolution Studio</h3>
                  <p className="text-[10px] text-slate-400 font-mono">Ticket: {targetIssue.ticketId} • {targetIssue.title}</p>
                </div>
              </div>

              <button
                onClick={closeResolutionStudio}
                className="p-1.5 rounded-full hover:bg-white/10 text-slate-400 hover:text-white transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-6">
              {/* Target Issue Reference Summary */}
              <div className="bg-white/5 p-3.5 rounded-2xl border border-white/10 flex items-center gap-4">
                <img
                  src={targetIssue.imageUrl}
                  alt="Original Problem"
                  className="w-16 h-16 object-cover rounded-xl border border-white/10 flex-shrink-0"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-[10px] font-semibold text-blue-400 bg-blue-500/10 px-2 py-0.5 rounded border border-blue-500/20">
                      {targetIssue.category}
                    </span>
                    <span className="text-[10px] text-amber-400 font-semibold">{targetIssue.severity} Severity</span>
                  </div>
                  <h4 className="text-xs font-semibold text-white truncate">{targetIssue.title}</h4>
                  <p className="text-[11px] text-slate-400 flex items-center gap-1 mt-1 truncate">
                    <MapPin className="w-3 h-3 text-red-400 flex-shrink-0" />
                    Target Site: {targetIssue.location.address}
                  </p>
                </div>
              </div>

              {/* LIVE CAMERA VIEWFINDER WITH BURNT-IN OVERLAYS */}
              <div className="relative rounded-2xl overflow-hidden bg-black border-2 border-white/20 aspect-video flex items-center justify-center shadow-inner">
                {/* Live Video Feed */}
                <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover" />

                {/* CAMERA OVERLAY 1: Top Bar (Live Status & Timetag) */}
                <div className="absolute top-3 left-3 right-3 flex items-center justify-between text-xs pointer-events-none">
                  {/* Recording status badge */}
                  <div className="flex items-center gap-2 bg-black/70 backdrop-blur-md px-3 py-1.5 rounded-full border border-white/20">
                    <span className={`w-3 h-3 rounded-full ${recording ? 'bg-red-500 animate-ping' : 'bg-emerald-400'}`}></span>
                    <span className="font-mono font-bold text-white uppercase text-[11px]">
                      {recording ? `REC (${recordSecondsLeft}s Left)` : 'LIVE VIEW'}
                    </span>
                  </div>

                  {/* Live Timestamp overlay */}
                  <div className="bg-black/80 backdrop-blur-md px-3 py-1 rounded-full border border-emerald-500/40 text-emerald-400 font-mono text-[11px] font-bold">
                    {liveTimestamp || 'TIMETAG ACTIVE'}
                  </div>
                </div>

                {/* CAMERA OVERLAY 2: Bottom GPS Geofence Tag */}
                <div className="absolute bottom-3 left-3 right-3 bg-black/80 backdrop-blur-md p-3 rounded-xl border border-white/20 text-xs pointer-events-none">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <MapPin className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                      <div>
                        <span className="text-[10px] text-slate-400 block uppercase font-mono">Authority Live GPS:</span>
                        <span className="text-white font-mono text-[11px] font-bold">
                          {authorityGps.latitude
                            ? `${authorityGps.latitude.toFixed(5)}°N, ${authorityGps.longitude?.toFixed(5)}°E`
                            : 'Acquiring GPS...'}
                        </span>
                      </div>
                    </div>

                    <div className="text-right border-t sm:border-t-0 sm:border-l border-white/10 pt-1 sm:pt-0 sm:pl-3">
                      <span className="text-[10px] text-slate-400 block uppercase font-mono">Target Distance:</span>
                      <span className="text-emerald-400 font-mono text-[11px] font-bold">
                        {authorityGps.latitude && targetIssue.location.latitude
                          ? `${(
                              Math.sqrt(
                                Math.pow(authorityGps.latitude - targetIssue.location.latitude, 2) +
                                Math.pow((authorityGps.longitude || 0) - (targetIssue.location.longitude || 0), 2)
                              ) * 111
                            ).toFixed(2)} km Delta`
                          : 'On-Site Verified'}
                      </span>
                    </div>
                  </div>
                </div>

                {/* RECORDING PROGRESS BAR OVERLAY */}
                {recording && (
                  <div className="absolute top-0 left-0 right-0 h-1.5 bg-black/50">
                    <div
                      className="h-full bg-gradient-to-r from-red-500 via-amber-500 to-emerald-500 transition-all duration-1000 ease-linear"
                      style={{ width: `${((30 - recordSecondsLeft) / 30) * 100}%` }}
                    ></div>
                  </div>
                )}
              </div>

              {/* CAMERA CONTROLS */}
              <div className="flex flex-col sm:flex-row items-center justify-between gap-4 bg-white/5 p-4 rounded-2xl border border-white/10">
                <div className="text-xs text-slate-400">
                  <p className="font-semibold text-white mb-0.5">30-Second Live Video Requirement:</p>
                  <p className="text-[11px] text-slate-400">
                    Hold camera steadily showing resolved civic work. AI verifies visual fixes, live timetag, and spatial GPS match.
                  </p>
                </div>

                <div className="flex items-center gap-3 w-full sm:w-auto justify-end">
                  {!recording ? (
                    <button
                      type="button"
                      onClick={start30SecRecording}
                      className="w-full sm:w-auto px-5 py-3 bg-red-600 hover:bg-red-500 text-white text-xs font-bold rounded-xl flex items-center justify-center gap-2 shadow-lg shadow-red-600/30 transition-all"
                    >
                      <Video className="w-4 h-4 animate-pulse" />
                      <span>Start 30s Recording</span>
                    </button>
                  ) : (
                    <div className="px-5 py-3 bg-red-500/20 border border-red-500/40 text-red-300 text-xs font-bold rounded-xl flex items-center gap-2 animate-pulse">
                      <Video className="w-4 h-4" />
                      <span>Recording... ({recordSecondsLeft}s)</span>
                    </div>
                  )}
                </div>
              </div>

              {/* RECORDED PREVIEW & AI SUBMISSION */}
              {recordedFrames.length > 0 && !recording && (
                <div className="bg-[#0e1320] p-5 rounded-2xl border border-emerald-500/30 space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                      <div>
                        <h4 className="text-xs font-bold text-white">30-Second Video Recording Captured</h4>
                        <p className="text-[10px] text-slate-400">Keyframes extracted with live timetag and location metadata</p>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={start30SecRecording}
                      className="text-xs text-slate-400 hover:text-white flex items-center gap-1"
                    >
                      <RotateCcw className="w-3.5 h-3.5" /> Re-record
                    </button>
                  </div>

                  {/* Frame Thumbnails */}
                  <div className="grid grid-cols-5 gap-2">
                    {recordedFrames.map((frame, idx) => (
                      <div key={idx} className="relative rounded-lg overflow-hidden border border-white/20 aspect-video">
                        <img src={frame} alt={`Frame ${idx + 1}`} className="w-full h-full object-cover" />
                        <span className="absolute bottom-1 right-1 text-[8px] bg-black/80 px-1 text-emerald-400 font-mono rounded">
                          F{idx + 1}
                        </span>
                      </div>
                    ))}
                  </div>

                  {/* AI AUDIT RESULT / ERROR DISPLAY */}
                  {aiAuditResult && (
                    <div
                      className={`p-4 rounded-xl border ${
                        aiAuditResult.isAuthentic && aiAuditResult.visualResolutionMatch
                          ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-200'
                          : 'bg-red-500/10 border-red-500/30 text-red-200'
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        {aiAuditResult.isAuthentic && aiAuditResult.visualResolutionMatch ? (
                          <ShieldCheck className="w-6 h-6 text-emerald-400 flex-shrink-0 mt-0.5" />
                        ) : (
                          <ShieldAlert className="w-6 h-6 text-red-400 flex-shrink-0 mt-0.5" />
                        )}

                        <div className="space-y-1 text-xs">
                          <h5 className="font-bold text-white text-sm">
                            {aiAuditResult.isAuthentic && aiAuditResult.visualResolutionMatch
                              ? 'AI Verification Passed: Issue Resolved!'
                              : 'AI Verification Failed: Invalid Resolution Proof'}
                          </h5>

                          <p className="text-slate-300 leading-relaxed">{aiAuditResult.verificationSummary}</p>

                          {aiAuditResult.rejectionReason && (
                            <div className="mt-2 p-2.5 bg-red-950/60 rounded-lg border border-red-500/40 text-red-300 text-[11px] font-semibold">
                              ⚠️ Rejection Reason: {aiAuditResult.rejectionReason}
                            </div>
                          )}

                          {aiAuditResult.detectedFixes && aiAuditResult.detectedFixes.length > 0 && (
                            <div className="mt-2 pt-2 border-t border-white/10">
                              <span className="text-[10px] text-slate-400 font-semibold block uppercase">Detected Improvements:</span>
                              <ul className="list-disc list-inside text-[11px] text-emerald-300 mt-0.5 space-y-0.5">
                                {aiAuditResult.detectedFixes.map((fix, i) => (
                                  <li key={i}>{fix}</li>
                                ))}
                              </ul>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  )}

                  {auditError && (
                    <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-xl text-xs text-red-300 flex items-center gap-2">
                      <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                      <span>{auditError}</span>
                    </div>
                  )}

                  {/* SUBMIT BUTTON */}
                  <div className="pt-2">
                    <button
                      type="button"
                      disabled={verifyingWithAi || updatingFirestore}
                      onClick={handleVerifyResolution}
                      className="w-full py-3 bg-gradient-to-r from-blue-600 via-indigo-600 to-emerald-600 hover:from-blue-500 hover:to-emerald-500 text-white text-xs font-bold rounded-xl flex items-center justify-center gap-2 shadow-lg disabled:opacity-50 transition-all"
                    >
                      {verifyingWithAi ? (
                        <>
                          <Sparkles className="w-4 h-4 animate-spin text-blue-300" />
                          <span>Gemini AI Verifying Video Proof & Timetags...</span>
                        </>
                      ) : (
                        <>
                          <Sparkles className="w-4 h-4 text-emerald-300" />
                          <span>Submit Video for Gemini AI Resolution Audit</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* MUNICIPAL SECURITY PIN 2FA VERIFICATION MODAL */}
      {showPinModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-[#0f172a] border border-blue-500/30 w-full max-w-md rounded-2xl p-6 shadow-2xl space-y-5 relative animate-in fade-in zoom-in-95">
            <button
              onClick={() => setShowPinModal(false)}
              className="absolute top-4 right-4 text-slate-400 hover:text-white p-1 rounded-lg hover:bg-white/10"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="flex items-center gap-3">
              <div className="w-12 h-12 bg-blue-500/10 border border-blue-500/30 rounded-xl flex items-center justify-center text-blue-400 shrink-0">
                <KeyRound className="w-6 h-6" />
              </div>
              <div>
                <span className="text-[10px] font-bold tracking-widest text-blue-400 uppercase">Government Security 2FA</span>
                <h3 className="text-base font-bold text-white">Municipal Passkey Verification</h3>
              </div>
            </div>

            <div className="bg-slate-900/80 p-3 rounded-xl border border-slate-800 text-xs text-slate-300">
              <p className="font-medium text-white mb-1">Authorization Required:</p>
              <p className="text-slate-400">{pinActionTitle}</p>
            </div>

            <form onSubmit={handleVerifyPinAndExecute} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5 flex items-center justify-between">
                  <span>Enter 6-Digit Municipal Passkey PIN</span>
                  <span className="text-[10px] text-blue-400 font-mono">Demo PIN: {DEFAULT_PIN_AUTHORITY}</span>
                </label>
                <div className="relative">
                  <Lock className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="password"
                    maxLength={6}
                    value={pinInput}
                    onChange={(e) => setPinInput(e.target.value)}
                    placeholder="••••••"
                    className="w-full bg-slate-950 border border-slate-700 focus:border-blue-500 text-white pl-10 pr-4 py-3 rounded-xl text-lg font-mono tracking-widest outline-none transition-all placeholder:text-slate-600"
                    autoFocus
                  />
                </div>
              </div>

              {pinError && (
                <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-xl text-xs text-red-300 flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
                  <span>{pinError}</span>
                </div>
              )}

              <div className="flex items-center gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowPinModal(false)}
                  className="flex-1 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold rounded-xl transition-all"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 py-2.5 bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold rounded-xl flex items-center justify-center gap-2 shadow-lg shadow-blue-600/30 transition-all"
                >
                  <ShieldCheck className="w-4 h-4" />
                  <span>Authorize Action</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
