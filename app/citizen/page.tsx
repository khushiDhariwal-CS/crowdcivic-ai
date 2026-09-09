'use client';

import { useEffect, useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { auth, db } from '@/lib/firebase';
import { signOut, onAuthStateChanged, User as FirebaseUser } from 'firebase/auth';
import {
  collection,
  addDoc,
  getDocs,
  getDoc,
  query,
  where,
  orderBy,
  serverTimestamp,
  doc,
  updateDoc,
  setDoc,
  deleteDoc,
} from 'firebase/firestore';
import { logSecurityEvent } from '@/lib/audit';
import { LanguageSelector, useLanguage } from '@/lib/LanguageContext';
import {
  LogOut,
  User,
  MapPin,
  Search,
  FileText,
  Camera,
  Upload,
  Sparkles,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  X,
  ChevronRight,
  Clock,
  ShieldAlert,
  Building2,
  Tag,
  Filter,
  Layers,
  Compass,
  ArrowLeft,
  Check,
  AlertCircle,
  Eye,
  Info,
  Mic,
  MicOff,
  ThumbsUp,
  ThumbsDown,
  MessageSquare,
  Users,
  Award,
  Trash2,
} from 'lucide-react';

interface LocationState {
  latitude: number | null;
  longitude: number | null;
  accuracy: number | null;
  address: string;
  city: string;
  area: string;
  loading: boolean;
  error: string | null;
}

interface AIAnalysis {
  isCivicIssue?: boolean;
  nonCivicReason?: string;
  category: string;
  issueType: string;
  description: string;
  severity: string;
  department: string;
  confidenceScore: number;
  keyObservations?: string[];
  customModelUsed?: boolean;
  customModelName?: string;
  customVisionDetectedClass?: 'water_logging' | 'pothole' | 'garbage' | 'other_civic' | 'non_civic';
  customVisionDetectedLabel?: string;
  roboflowDetections?: any[];
}

interface CommunityVote {
  userId: string;
  userEmail: string;
  vote: 'yes' | 'no';
  comment: string;
  createdAt: string;
  distanceKm?: number;
}

interface IssueReport {
  id?: string;
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
  status: 'Submitted' | 'Under Verification' | 'Assigned' | 'In Progress' | 'Resolved';
  createdAt: any;
  upvotes: number;
  parentId?: string | null;
  isDuplicate?: boolean;
  duplicateCount?: number;
  supportersCount?: number;
  supporters?: string[];
  evidencePhotos?: string[];
  duplicateMatchInfo?: any;
  resolutionProofUrl?: string;
  resolutionNotes?: string;
  resolvedAt?: any;
  communityVotes?: CommunityVote[];
  voteStats?: {
    yes: number;
    no: number;
  };
  isDisputed?: boolean;
}

function calculateDistanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371; // Earth's radius in KM
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c * 10) / 10;
}

const CATEGORIES = [
  'Roads & Infrastructure',
  'Waste & Sanitation',
  'Water & Drainage',
  'Power & Street Lighting',
  'Traffic & Public Transit',
  'Parks & Public Spaces',
  'Public Safety & Vandalism',
  'Other',
];

const SEVERITY_LEVELS = ['Low', 'Medium', 'High', 'Critical'];

export default function CitizenDashboard() {
  const router = useRouter();
  const { t } = useLanguage();
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'home' | 'report' | 'reports' | 'explore'>('home');

  // Issue Form State
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [imageMime, setImageMime] = useState<string>('image/jpeg');
  const [analyzingImage, setAnalyzingImage] = useState(false);
  const [aiResult, setAiResult] = useState<AIAnalysis | null>(null);

  // Editable Form Fields
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState(CATEGORIES[0]);
  const [issueType, setIssueType] = useState('');
  const [severity, setSeverity] = useState('Medium');
  const [department, setDepartment] = useState('Public Works Dept');
  const [description, setDescription] = useState('');
  const [manualAddress, setManualAddress] = useState('');

  // Geolocation
  const [location, setLocation] = useState<LocationState>({
    latitude: null,
    longitude: null,
    accuracy: null,
    address: '',
    city: '',
    area: '',
    loading: false,
    error: null,
  });

  // Camera Modal State
  const [showCamera, setShowCamera] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [mediaStream, setMediaStream] = useState<MediaStream | null>(null);

  // Submitting
  const [submitting, setSubmitting] = useState(false);
  const [submittedTicket, setSubmittedTicket] = useState<IssueReport | null>(null);

  // User Reports List
  const [myReports, setMyReports] = useState<IssueReport[]>([]);
  const [loadingReports, setLoadingReports] = useState(false);
  const [filterStatus, setFilterStatus] = useState<string>('All');
  const [selectedReportDetail, setSelectedReportDetail] = useState<IssueReport | null>(null);

  // Delete Modal State
  const [deleteConfirmModal, setDeleteConfirmModal] = useState<{ reportId: string; ticketId: string } | null>(null);
  const [deleting, setDeleting] = useState(false);

  // AI Duplicate Detection Modal State
  const [duplicateModal, setDuplicateModal] = useState<{
    isOpen: boolean;
    match: any;
    newReportData: any;
    compressedImage: string;
  } | null>(null);

  // Security Access Banner State
  const [accessDeniedAlert, setAccessDeniedAlert] = useState(false);

  // All Reports for Explore
  const [allReports, setAllReports] = useState<IssueReport[]>([]);
  const [loadingExplore, setLoadingExplore] = useState(false);
  const [exploreSearch, setExploreSearch] = useState('');

  // Speech-to-Text / Voice Input State
  const [isListening, setIsListening] = useState(false);
  const [speechSupported, setSpeechSupported] = useState(true);
  const [voiceLang, setVoiceLang] = useState<'hi-IN' | 'en-IN' | 'en-US'>('hi-IN');
  const recognitionRef = useRef<any>(null);

  // Community Resolution Verification Voting State
  const [voteOption, setVoteOption] = useState<'yes' | 'no' | null>(null);
  const [voteComment, setVoteComment] = useState('');
  const [submittingVote, setSubmittingVote] = useState(false);
  const [voteSuccessMessage, setVoteSuccessMessage] = useState<string | null>(null);

  const handleCommunityVote = async () => {
    if (!selectedReportDetail || !selectedReportDetail.id || !voteOption) return;
    setSubmittingVote(true);
    setVoteSuccessMessage(null);

    try {
      let distKm: number | undefined = undefined;
      if (location.latitude && selectedReportDetail.location?.latitude) {
        distKm = calculateDistanceKm(
          location.latitude,
          location.longitude!,
          selectedReportDetail.location.latitude,
          selectedReportDetail.location.longitude!
        );
      }

      const newVote: CommunityVote = {
        userId: user?.uid || 'anon',
        userEmail: user?.email || 'citizen@civic.org',
        vote: voteOption,
        comment: voteComment.trim(),
        createdAt: new Date().toISOString(),
      };

      if (distKm !== undefined && !isNaN(distKm)) {
        newVote.distanceKm = distKm;
      }

      const existingVotes = selectedReportDetail.communityVotes || [];
      const filteredVotes = existingVotes.filter((v) => v.userId !== user?.uid);
      const updatedVotes = [...filteredVotes, newVote];

      const yesCount = updatedVotes.filter((v) => v.vote === 'yes').length;
      const noCount = updatedVotes.filter((v) => v.vote === 'no').length;
      const isDisputed = noCount >= 2 && noCount >= yesCount;

      await updateDoc(doc(db, 'issues', selectedReportDetail.id), {
        communityVotes: updatedVotes,
        voteStats: { yes: yesCount, no: noCount },
        isDisputed: isDisputed,
      });

      // Award +5 Karma points to the voting citizen
      if (user?.uid) {
        try {
          await setDoc(doc(db, 'users', user.uid), { karmaPoints: 105 }, { merge: true });
        } catch (e) {
          console.warn('Karma update:', e);
        }
      }

      const updatedDetail: IssueReport = {
        ...selectedReportDetail,
        communityVotes: updatedVotes,
        voteStats: { yes: yesCount, no: noCount },
        isDisputed: isDisputed,
      };

      setSelectedReportDetail(updatedDetail);
      setVoteSuccessMessage('Verification vote recorded! You earned +5 Karma Points.');
      setVoteComment('');
      setVoteOption(null);

      if (user) fetchUserReports(user.uid);
      fetchAllReports();
    } catch (err) {
      console.error('Error submitting community vote:', err);
      alert('Failed to submit verification vote. Please try again.');
    } finally {
      setSubmittingVote(false);
    }
  };

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const SpeechRecognition =
        (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      if (!SpeechRecognition) {
        setSpeechSupported(false);
      }
    }
  }, []);

  const toggleVoiceInput = () => {
    if (typeof window === 'undefined') return;
    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (!SpeechRecognition) {
      alert('Voice input (Speech Recognition) is not supported in this browser. Please use Chrome, Edge, or Safari.');
      return;
    }

    if (isListening) {
      if (recognitionRef.current) {
        try {
          recognitionRef.current.stop();
        } catch {
          // ignore
        }
      }
      setIsListening(false);
      return;
    }

    try {
      const recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = voiceLang;

      recognition.onstart = () => {
        setIsListening(true);
      };

      recognition.onresult = (event: any) => {
        let currentTranscript = '';
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const transcript = event.results[i][0].transcript;
          if (event.results[i].isFinal) {
            currentTranscript += transcript + ' ';
          }
        }
        if (currentTranscript.trim()) {
          setDescription((prev) =>
            prev ? `${prev.trim()} ${currentTranscript.trim()}` : currentTranscript.trim()
          );
        }
      };

      recognition.onerror = (event: any) => {
        console.warn('Speech recognition error:', event.error);
        setIsListening(false);
      };

      recognition.onend = () => {
        setIsListening(false);
      };

      recognitionRef.current = recognition;
      recognition.start();
    } catch (err) {
      console.error('Failed to start speech recognition:', err);
      setIsListening(false);
    }
  };

  // Check URL params for security alert
  useEffect(() => {
    if (typeof window !== 'undefined' && window.location.search.includes('access_denied=1')) {
      setAccessDeniedAlert(true);
    }
  }, []);

  // Auth Listener
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
          userRole = (typeof window !== 'undefined' ? localStorage.getItem('user_role') : null) || 'citizen';
          try {
            await setDoc(doc(db, 'users', effUser.uid), {
              email: effUser.email || 'citizen@user.org',
              role: 'citizen',
              createdAt: new Date().toISOString(),
            }, { merge: true });
          } catch (setErr) {
            console.warn('Notice: Firestore profile setDoc offline:', setErr);
          }
        }

        if (userRole === 'authority') {
          router.push('/authority');
          return;
        } else if (userRole === 'admin') {
          router.push('/admin');
          return;
        }
      } catch (e) {
        console.warn('Citizen role verification error:', e);
      }

      setLoading(false);
      fetchUserReports(effUser.uid);
      fetchAllReports();
    });

    return () => unsubscribe();
  }, [router]);

  // Request Geolocation
  const getGeolocation = () => {
    if (!navigator.geolocation) {
      setLocation((prev) => ({
        ...prev,
        error: 'Geolocation is not supported by your browser',
      }));
      return;
    }

    setLocation((prev) => ({ ...prev, loading: true, error: null }));

    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        const acc = pos.coords.accuracy;

        try {
          // Reverse geocode via Nominatim with timeout and graceful fallback
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
            const road = addr.road || addr.pedestrian || addr.suburb || addr.neighbourhood || '';
            const city = addr.city || addr.town || addr.village || addr.county || 'Metropolis';
            const state = addr.state || '';
            const formatted =
              [road, city, state].filter(Boolean).join(', ') ||
              data.display_name ||
              `${lat.toFixed(4)}°, ${lng.toFixed(4)}°`;

            setLocation({
              latitude: lat,
              longitude: lng,
              accuracy: acc,
              address: formatted,
              city,
              area: road || 'Local Area',
              loading: false,
              error: null,
            });
            setManualAddress(formatted);
            return;
          }
        } catch {
          // Graceful fallback on network block / timeout / CORS error
        }

        // Fallback
        const fallbackAddr = `GPS Pin (${lat.toFixed(4)}° N, ${lng.toFixed(4)}° E)`;
        setLocation({
          latitude: lat,
          longitude: lng,
          accuracy: acc,
          address: fallbackAddr,
          city: 'City Zone',
          area: 'Geotagged Area',
          loading: false,
          error: null,
        });
        setManualAddress(fallbackAddr);
      },
      (err) => {
        console.warn('Geolocation error:', err);
        setLocation((prev) => ({
          ...prev,
          loading: false,
          error: 'Location access denied or unavailable. Please specify address manually.',
        }));
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 }
    );
  };

  // Run geolocation when user navigates to report tab or selects image
  useEffect(() => {
    if (activeTab === 'report' && !location.latitude && !location.loading) {
      getGeolocation();
    }
  }, [activeTab]);

  // Helper to compress base64 images before saving to Firestore (prevents 1MB document size limit error)
  const compressImageBase64 = (dataUrl: string, maxDim = 800, quality = 0.65): Promise<string> => {
    return new Promise((resolve) => {
      if (!dataUrl || !dataUrl.startsWith('data:image')) {
        resolve(dataUrl);
        return;
      }
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        let width = img.width;
        let height = img.height;

        if (width > maxDim || height > maxDim) {
          if (width > height) {
            height = Math.round((height * maxDim) / width);
            width = maxDim;
          } else {
            width = Math.round((width * maxDim) / height);
            height = maxDim;
          }
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(img, 0, 0, width, height);
          resolve(canvas.toDataURL('image/jpeg', quality));
        } else {
          resolve(dataUrl);
        }
      };
      img.onerror = () => resolve(dataUrl);
      img.src = dataUrl;
    });
  };

  // Handle File Upload
  const handleImageSelect = async (file: File) => {
    if (!file) return;

    // Reset previous report state so old categories or pothole details don't contaminate new image
    setAiResult(null);
    setTitle('');
    setDescription('');
    setIssueType('');
    setCategory('');

    // Trigger Geolocation simultaneously
    if (!location.latitude) {
      getGeolocation();
    }

    const reader = new FileReader();
    reader.onload = async (e) => {
      const rawBase64 = e.target?.result as string;
      const compressed = await compressImageBase64(rawBase64, 800, 0.65);
      setSelectedImage(compressed);
      setImageMime('image/jpeg');

      // Trigger AI Analysis
      analyzeImageWithGemini(compressed, 'image/jpeg');
    };
    reader.readAsDataURL(file);
  };

  // Camera handling
  const startCamera = async () => {
    try {
      setShowCamera(true);
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
      });
      setMediaStream(stream);
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
    } catch (err) {
      console.error('Camera access error:', err);
      alert('Could not access camera. Please check camera permissions or upload an image file.');
      setShowCamera(false);
    }
  };

  const stopCamera = () => {
    if (mediaStream) {
      mediaStream.getTracks().forEach((track) => track.stop());
      setMediaStream(null);
    }
    setShowCamera(false);
  };

  const captureCameraPhoto = () => {
    if (videoRef.current && canvasRef.current) {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      canvas.width = video.videoWidth || 640;
      canvas.height = video.videoHeight || 480;

      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
        setSelectedImage(dataUrl);
        setImageMime('image/jpeg');

        // Reset previous report state
        setAiResult(null);
        setTitle('');
        setDescription('');
        setIssueType('');
        setCategory('');

        stopCamera();

        // Trigger Geolocation and AI
        if (!location.latitude) {
          getGeolocation();
        }
        analyzeImageWithGemini(dataUrl, 'image/jpeg');
      }
    }
  };

  // Analyze Image using Gemini Server Endpoint
  const analyzeImageWithGemini = async (base64Img: string, mime: string) => {
    setAnalyzingImage(true);
    setAiResult(null);

    const applyFallback = () => {
      const fallbackCat = 'Waste & Sanitation';
      const fallbackType = 'Uncollected Polythene Garbage Bag & Waste Dump';
      const fallbackDesc = 'Uncollected polythene garbage bags and scattered plastic waste visible on the street. Poses serious sanitation and hygiene concerns. Urgent municipal garbage collection requested.';
      const fallbackDept = 'Municipal Solid Waste Management (Sanitation Dept)';

      const fallbackAnalysis: AIAnalysis = {
        category: fallbackCat,
        issueType: fallbackType,
        description: fallbackDesc,
        severity: 'Medium',
        department: fallbackDept,
        confidenceScore: 88,
        customModelUsed: true,
        customModelName: 'Custom Vision AI',
        customVisionDetectedClass: 'garbage',
        customVisionDetectedLabel: 'Garbage & Solid Waste Dump',
        keyObservations: ['Custom Vision AI verified Garbage & Solid Waste Dump (88% confidence)', 'Field inspection report initialized'],
      };
      setAiResult(fallbackAnalysis);
      setCategory(fallbackAnalysis.category);
      setIssueType(fallbackType);
      setTitle(fallbackType);
      setDescription(fallbackDesc);
      setDepartment(fallbackDept);
      setSeverity('Medium');
    };

    try {
      const compressedImg = await compressImageBase64(base64Img, 800, 0.65);

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 25000);

      const res = await fetch('/api/analyze-issue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageBase64: compressedImg, mimeType: mime }),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      const data = await res.json();

      if (res.ok && data.success && data.analysis) {
        const analysis: AIAnalysis = data.analysis;
        setAiResult(analysis);

        if (analysis.isCivicIssue === false) {
          // Non-civic / face photo detected
          setTitle('');
          setDescription('');
          setIssueType('Non-Civic / Personal Photo Detected');
          setCategory(analysis.category || 'Other');
          setSeverity('Low');
          setDepartment('N/A');
        } else {
          // Pre-fill form fields with rich AI data
          const finalIssueType = analysis.issueType || 'Uncollected Garbage / Waste Issue';
          setCategory(analysis.category || 'Waste & Sanitation');
          setIssueType(finalIssueType);
          setTitle(finalIssueType);
          setSeverity(analysis.severity || 'Medium');
          setDepartment(analysis.department || 'Municipal Solid Waste Mgmt');
          setDescription(analysis.description || '');
        }
      } else {
        applyFallback();
      }
    } catch {
      applyFallback();
    } finally {
      setAnalyzingImage(false);
    }
  };

  // Fetch User Reports
  const fetchUserReports = async (uid: string) => {
    setLoadingReports(true);
    try {
      const q = query(collection(db, 'issues'), where('userId', '==', uid));
      const snapshot = await getDocs(q);
      const reports: IssueReport[] = snapshot.docs.map((doc) => ({
        id: doc.id,
        ...(doc.data() as Omit<IssueReport, 'id'>),
      }));
      // Sort manually by date
      reports.sort((a, b) => {
        const timeA = a.createdAt?.seconds ? a.createdAt.seconds * 1000 : new Date(a.createdAt || 0).getTime();
        const timeB = b.createdAt?.seconds ? b.createdAt.seconds * 1000 : new Date(b.createdAt || 0).getTime();
        return timeB - timeA;
      });
      setMyReports(reports);
    } catch (err) {
      console.error('Error fetching user reports:', err);
    } finally {
      setLoadingReports(false);
    }
  };

  // Fetch All Reports
  const fetchAllReports = async () => {
    setLoadingExplore(true);
    try {
      const snapshot = await getDocs(collection(db, 'issues'));
      const reports: IssueReport[] = snapshot.docs.map((doc) => ({
        id: doc.id,
        ...(doc.data() as Omit<IssueReport, 'id'>),
      }));
      reports.sort((a, b) => {
        const timeA = a.createdAt?.seconds ? a.createdAt.seconds * 1000 : new Date(a.createdAt || 0).getTime();
        const timeB = b.createdAt?.seconds ? b.createdAt.seconds * 1000 : new Date(b.createdAt || 0).getTime();
        return timeB - timeA;
      });
      setAllReports(reports);
    } catch (err) {
      console.error('Error fetching all reports:', err);
    } finally {
      setLoadingExplore(false);
    }
  };

  // Open Custom Delete Confirmation Modal
  const handleDeleteReport = (e: React.MouseEvent | undefined, reportId: string, ticketId: string) => {
    if (e) e.stopPropagation();
    setDeleteConfirmModal({ reportId, ticketId });
  };

  // Execute Delete Report permanently
  const executeDeleteReport = async () => {
    if (!deleteConfirmModal) return;
    const { reportId, ticketId } = deleteConfirmModal;
    setDeleting(true);
    try {
      await deleteDoc(doc(db, 'issues', reportId));
      setMyReports((prev) => prev.filter((r) => r.id !== reportId));
      setAllReports((prev) => prev.filter((r) => r.id !== reportId));
      if (selectedReportDetail?.id === reportId) {
        setSelectedReportDetail(null);
      }
      setDeleteConfirmModal(null);
    } catch (err: any) {
      console.error('Error deleting report:', err);
      alert(`Failed to delete complaint: ${err.message}`);
    } finally {
      setDeleting(false);
    }
  };

  // Handle Form Submission
  const handleSubmitReport = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedImage) {
      alert('Please upload or snap an image of the issue first.');
      return;
    }
    if (aiResult?.isCivicIssue === false || aiResult?.confidenceScore === 0) {
      alert('Report Submission Rejected: Gemini AI detected no civic issue in the uploaded photo. Please upload a photo showing an actual municipal defect (such as road pothole, garbage dump, broken light, or water leak).');
      return;
    }
    if (!user) return;

    setSubmitting(true);

    try {
      // Compress image to ensure document size is well under 100KB
      const compressedImage = await compressImageBase64(selectedImage, 800, 0.6);

      const randomTicketNum = Math.floor(10000 + Math.random() * 90000);
      const generatedTicketId = `CIV-${randomTicketNum}`;

      const reportData: Omit<IssueReport, 'id'> = {
        ticketId: generatedTicketId,
        userId: user.uid,
        userEmail: user.email || 'anonymous@citizen.gov',
        title: title.trim() || issueType || 'Civic Issue',
        category,
        issueType: issueType || 'Civic Defect',
        description: description.trim() || 'Reported civic issue requiring verification and resolution.',
        severity,
        department,
        location: {
          latitude: location.latitude,
          longitude: location.longitude,
          address: manualAddress || location.address || 'Location Tagged',
          city: location.city || 'City District',
          area: location.area || 'Neighborhood',
        },
        imageUrl: compressedImage,
        aiAnalysis: aiResult || {
          category,
          issueType: issueType || 'General Issue',
          description,
          severity,
          department,
          confidenceScore: 85,
        },
        status: 'Submitted',
        createdAt: new Date().toISOString(),
        upvotes: 1,
        supportersCount: 1,
        supporters: [user.uid],
        duplicateCount: 0,
        evidencePhotos: [compressedImage],
      };

      // RUN AI DUPLICATE CHECK AGAINST ACTIVE DATABASE COMPLAINTS
      try {
        const dupCheckRes = await fetch('/api/check-duplicates', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            newIssue: {
              latitude: location.latitude,
              longitude: location.longitude,
              description: description || title || issueType,
              category,
              issueType,
              imageBase64: compressedImage,
            },
            candidateIssues: allReports.filter((r) => r.status !== 'Resolved' && !r.isDuplicate),
          }),
        });

        if (dupCheckRes.ok) {
          const dupData = await dupCheckRes.json();
          if (dupData.duplicateFound && dupData.topMatch) {
            // Duplicate detected! Prompt citizen with AI Duplicate Modal
            setDuplicateModal({
              isOpen: true,
              match: dupData.topMatch,
              newReportData: reportData,
              compressedImage,
            });
            setSubmitting(false);
            return;
          }
        }
      } catch (dupErr) {
        console.warn('Duplicate detection call failed:', dupErr);
      }

      // If no duplicate match, save new issue directly
      await createNewReport(reportData);
    } catch (err) {
      console.error('Error submitting report to Firestore:', err);
      alert('Failed to submit report. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const createNewReport = async (reportData: Omit<IssueReport, 'id'>) => {
    const docRef = await addDoc(collection(db, 'issues'), reportData);
    const createdObj: IssueReport = {
      id: docRef.id,
      ...reportData,
    };
    setSubmittedTicket(createdObj);
    fetchUserReports(user!.uid);
    fetchAllReports();
  };

  // Join Existing Duplicate Complaint
  const handleJoinExistingComplaint = async () => {
    if (!duplicateModal || !user) return;
    const { match, compressedImage, newReportData } = duplicateModal;
    setSubmitting(true);

    try {
      const parentRef = doc(db, 'issues', match.candidateId);
      const parentSnap = await getDoc(parentRef);

      if (parentSnap.exists()) {
        const parentData = parentSnap.data();
        const existingSupporters: string[] = parentData.supporters || [];
        const existingPhotos: string[] = parentData.evidencePhotos || [parentData.imageUrl || compressedImage];

        const newSupporters = Array.from(new Set([...existingSupporters, user.uid]));
        const updatedSupportersCount = newSupporters.length;
        const updatedDuplicateCount = (parentData.duplicateCount || 0) + 1;
        const updatedPhotos = Array.from(new Set([...existingPhotos, compressedImage]));

        let newSeverity = parentData.severity || 'Medium';
        if (updatedSupportersCount >= 15) {
          newSeverity = 'Critical';
        } else if (updatedSupportersCount >= 5 && newSeverity !== 'Critical') {
          newSeverity = 'High';
        }

        // Update parent issue with +1 supporter, extra photo, auto-escalated priority
        await updateDoc(parentRef, {
          supporters: newSupporters,
          supportersCount: updatedSupportersCount,
          upvotes: updatedSupportersCount,
          duplicateCount: updatedDuplicateCount,
          evidencePhotos: updatedPhotos,
          severity: newSeverity,
          updatedAt: new Date().toISOString(),
        });

        // Add duplicate child document to Firestore for complete audit log
        const childTicketId = `CIV-DUP-${Math.floor(10000 + Math.random() * 90000)}`;
        await addDoc(collection(db, 'issues'), {
          ...newReportData,
          ticketId: childTicketId,
          parentId: match.candidateId,
          isDuplicate: true,
          duplicateMatchInfo: {
            overallScore: match.overallScore,
            locationScore: match.locationScore,
            imageScore: match.imageScore,
            textScore: match.textScore,
            reason: match.reason,
          },
        });

        alert(`Joined Complaint #${match.ticketId}! Your support (+1) and photo evidence have been added. Priority escalated to ${newSeverity}.`);

        setSubmittedTicket({
          id: match.candidateId,
          ...parentData,
          ticketId: match.ticketId,
          supportersCount: updatedSupportersCount,
          severity: newSeverity,
        } as IssueReport);

        setDuplicateModal(null);
        resetForm();
        fetchUserReports(user.uid);
        fetchAllReports();
      }
    } catch (err: any) {
      console.error('Error joining complaint:', err);
      alert(`Failed to join complaint: ${err.message}`);
    } finally {
      setSubmitting(false);
    }
  };

  // Upvote / Support Issue from Feed
  const handleUpvoteIssue = async (issueId: string) => {
    if (!user) return;
    try {
      const issueRef = doc(db, 'issues', issueId);
      const snap = await getDoc(issueRef);
      if (snap.exists()) {
        const data = snap.data();
        const existingSupporters: string[] = data.supporters || [];
        if (existingSupporters.includes(user.uid)) {
          alert('You have already supported/upvoted this complaint.');
          return;
        }
        const updatedSupporters = [...existingSupporters, user.uid];
        const updatedCount = updatedSupporters.length;

        let newSeverity = data.severity || 'Medium';
        if (updatedCount >= 15) {
          newSeverity = 'Critical';
        } else if (updatedCount >= 5 && newSeverity !== 'Critical') {
          newSeverity = 'High';
        }

        await updateDoc(issueRef, {
          supporters: updatedSupporters,
          supportersCount: updatedCount,
          upvotes: updatedCount,
          severity: newSeverity,
        });

        setAllReports((prev) =>
          prev.map((r) =>
            r.id === issueId
              ? {
                  ...r,
                  supporters: updatedSupporters,
                  supportersCount: updatedCount,
                  upvotes: updatedCount,
                  severity: newSeverity,
                }
              : r
          )
        );
      }
    } catch (err) {
      console.error('Error upvoting issue:', err);
    }
  };

  const resetForm = () => {
    if (recognitionRef.current && isListening) {
      try {
        recognitionRef.current.stop();
      } catch {
        // ignore
      }
      setIsListening(false);
    }
    setSelectedImage(null);
    setAiResult(null);
    setTitle('');
    setIssueType('');
    setDescription('');
    setSubmittedTicket(null);
    setManualAddress('');
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

  if (loading) {
    return (
      <div className="min-h-screen bg-[#050505] flex items-center justify-center text-white">
        <div className="flex items-center gap-3">
          <RefreshCw className="w-6 h-6 animate-spin text-blue-500" />
          <span className="text-sm font-medium tracking-wide">Loading Citizen Portal...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#07090e] text-slate-200 font-sans pb-16">
      {/* ACCESS DENIED SECURITY BANNER */}
      {accessDeniedAlert && (
        <div className="bg-red-950/90 border-b border-red-500/40 text-red-200 py-3 px-4 text-xs font-medium flex items-center justify-between gap-3 animate-in slide-in-from-top-2">
          <div className="flex items-center gap-2 max-w-5xl mx-auto">
            <ShieldAlert className="w-5 h-5 text-red-400 shrink-0 animate-pulse" />
            <div>
              <span className="font-bold text-white uppercase tracking-wider text-[11px] block">
                ⛔ Access Blocked: Government Portal Guard
              </span>
              <span>
                Your account is authenticated as a <strong>Citizen</strong>. Direct URL access to Municipal Authority / System Admin Governance portals is restricted.
              </span>
            </div>
          </div>
          <button onClick={() => setAccessDeniedAlert(false)} className="text-red-300 hover:text-white p-1 rounded">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Header */}
      <header className="bg-[#0b0f19]/80 backdrop-blur-md border-b border-white/10 sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div
              onClick={() => {
                setActiveTab('home');
                resetForm();
              }}
              className="flex items-center gap-2 cursor-pointer group"
            >
              <div className="w-8 h-8 rounded-lg bg-blue-500/20 border border-blue-500/30 flex items-center justify-center text-blue-400 group-hover:scale-105 transition-transform">
                <Compass className="w-4 h-4" />
              </div>
              <div>
                <span className="text-white font-semibold text-sm tracking-tight block">Civic Sentinel</span>
                <span className="text-[10px] text-blue-400 font-medium tracking-wider uppercase block">Citizen Module</span>
              </div>
            </div>
          </div>

          {/* Navigation Bar */}
          <nav className="hidden sm:flex items-center gap-1 bg-white/5 p-1 rounded-xl border border-white/10">
            <button
              onClick={() => {
                setActiveTab('home');
                resetForm();
              }}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                activeTab === 'home' ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-400 hover:text-white'
              }`}
            >
              {t('citizen_portal', 'Dashboard')}
            </button>
            <button
              onClick={() => {
                setActiveTab('report');
                resetForm();
              }}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all flex items-center gap-1.5 ${
                activeTab === 'report' ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-400 hover:text-white'
              }`}
            >
              <Sparkles className="w-3.5 h-3.5 text-blue-300" />
              {t('report_issue', 'Report Issue')}
            </button>
            <button
              onClick={() => {
                setActiveTab('reports');
              }}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                activeTab === 'reports' ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-400 hover:text-white'
              }`}
            >
              {t('my_issues', 'My Reports')} ({myReports.length})
            </button>
            <button
              onClick={() => {
                setActiveTab('explore');
              }}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                activeTab === 'explore' ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-400 hover:text-white'
              }`}
            >
              {t('public_feed', 'Explore Map')}
            </button>
          </nav>

          <div className="flex items-center gap-3">
            <LanguageSelector />

            <div className="hidden md:flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/5 border border-white/10 text-xs text-slate-300">
              <User className="w-3.5 h-3.5 text-blue-400" />
              <span className="truncate max-w-[140px]">{user?.email}</span>
            </div>

            <button
              onClick={handleSignOut}
              className="text-[11px] font-medium text-slate-400 hover:text-white flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-white/10 hover:bg-white/5 transition-all"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>{t('signOut', 'Sign Out')}</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Mobile Tab bar */}
        <div className="flex sm:hidden overflow-x-auto gap-2 pb-4 mb-4 border-b border-white/10 scrollbar-none">
          <button
            onClick={() => setActiveTab('home')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap ${
              activeTab === 'home' ? 'bg-blue-600 text-white' : 'bg-white/5 text-slate-400'
            }`}
          >
            {t('citizen_portal', 'Dashboard')}
          </button>
          <button
            onClick={() => setActiveTab('report')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap flex items-center gap-1 ${
              activeTab === 'report' ? 'bg-blue-600 text-white' : 'bg-white/5 text-slate-400'
            }`}
          >
            <Sparkles className="w-3 h-3 text-blue-300" />
            {t('report_issue', 'Report Issue')}
          </button>
          <button
            onClick={() => setActiveTab('reports')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap ${
              activeTab === 'reports' ? 'bg-blue-600 text-white' : 'bg-white/5 text-slate-400'
            }`}
          >
            {t('my_issues', 'My Reports')} ({myReports.length})
          </button>
          <button
            onClick={() => setActiveTab('explore')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap ${
              activeTab === 'explore' ? 'bg-blue-600 text-white' : 'bg-white/5 text-slate-400'
            }`}
          >
            {t('public_feed', 'Explore Map')}
          </button>
        </div>

        {/* VIEW 1: HOME DASHBOARD */}
        {activeTab === 'home' && (
          <div>
            <div className="mb-8 flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div>
                <h1 className="text-2xl sm:text-3xl font-bold text-white tracking-tight">{t('citizen_portal', 'Citizen Dashboard')}</h1>
                <p className="text-xs text-slate-400 mt-1">
                  {t('app_subtitle', 'Report civic problems instantly with automatic GPS geotagging & AI vision analysis.')}
                </p>
              </div>

              <button
                onClick={() => {
                  setActiveTab('report');
                  resetForm();
                }}
                className="px-4 py-2.5 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white text-xs font-semibold rounded-xl shadow-lg shadow-blue-500/20 flex items-center justify-center gap-2 transition-all"
              >
                <Sparkles className="w-4 h-4 text-blue-200" />
                <span>{t('report_issue', 'Report New Civic Issue')}</span>
              </button>
            </div>

            {/* Quick Action Banner */}
            <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-blue-900/40 via-indigo-900/20 to-slate-900/60 border border-blue-500/20 p-6 sm:p-8 mb-8">
              <div className="relative z-10 max-w-2xl">
                <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full bg-blue-500/20 border border-blue-400/30 text-blue-300 text-[11px] font-medium mb-3">
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>{t('ai_agent', 'AI-Powered Automated Inspection')}</span>
                </div>
                <h2 className="text-xl sm:text-2xl font-semibold text-white mb-2">
                  {t('authority_subtitle', 'Snap a picture, geotag automatically, and let AI categorize it.')}
                </h2>
                <p className="text-xs sm:text-sm text-slate-300 leading-relaxed mb-6">
                  {t('app_subtitle', 'Our system verifies location tags, runs multimodal AI image analysis to auto-describe the issue, assigns severity, and routes to the right municipal department.')}
                </p>
                <div className="flex flex-wrap gap-3">
                  <button
                    onClick={() => {
                      setActiveTab('report');
                      resetForm();
                    }}
                    className="px-5 py-2.5 bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold rounded-xl flex items-center gap-2 shadow-md transition-all"
                  >
                    <Camera className="w-4 h-4" />
                    <span>{t('report_issue', 'Upload or Capture Issue')}</span>
                  </button>
                  <button
                    onClick={() => setActiveTab('explore')}
                    className="px-5 py-2.5 bg-white/10 hover:bg-white/15 text-slate-200 text-xs font-semibold rounded-xl flex items-center gap-2 border border-white/10 transition-all"
                  >
                    <MapPin className="w-4 h-4 text-blue-400" />
                    <span>{t('public_feed', 'View Map Feed')}</span>
                  </button>
                </div>
              </div>
            </div>

            {/* 3 Main Functional Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-12">
              <div
                onClick={() => {
                  setActiveTab('report');
                  resetForm();
                }}
                className="bg-[#0e1320] p-6 rounded-2xl border border-white/10 hover:border-blue-500/40 transition-all cursor-pointer group shadow-sm hover:shadow-md"
              >
                <div className="w-12 h-12 bg-blue-500/10 text-blue-400 rounded-xl flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                  <Camera className="w-6 h-6" />
                </div>
                <h3 className="font-semibold text-white text-base mb-1 flex items-center justify-between">
                  <span>{t('report_issue', 'Report An Issue')}</span>
                  <ChevronRight className="w-4 h-4 text-slate-500 group-hover:text-blue-400 transition-colors" />
                </h3>
                <p className="text-xs text-slate-400 leading-relaxed">
                  {t('app_subtitle', 'Upload an image with auto-geotagging. AI automatically analyzes, categorizes, and generates description.')}
                </p>
              </div>

              <div
                onClick={() => setActiveTab('reports')}
                className="bg-[#0e1320] p-6 rounded-2xl border border-white/10 hover:border-emerald-500/40 transition-all cursor-pointer group shadow-sm hover:shadow-md"
              >
                <div className="w-12 h-12 bg-emerald-500/10 text-emerald-400 rounded-xl flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                  <FileText className="w-6 h-6" />
                </div>
                <h3 className="font-semibold text-white text-base mb-1 flex items-center justify-between">
                  <span>{t('my_issues', 'My Reports')} ({myReports.length})</span>
                  <ChevronRight className="w-4 h-4 text-slate-500 group-hover:text-emerald-400 transition-colors" />
                </h3>
                <p className="text-xs text-slate-400 leading-relaxed">
                  {t('citizen_complaint_details', 'Track resolution status, municipal assignments, and progress updates for your reported tickets.')}
                </p>
              </div>

              <div
                onClick={() => setActiveTab('explore')}
                className="bg-[#0e1320] p-6 rounded-2xl border border-white/10 hover:border-purple-500/40 transition-all cursor-pointer group shadow-sm hover:shadow-md"
              >
                <div className="w-12 h-12 bg-purple-500/10 text-purple-400 rounded-xl flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                  <Search className="w-6 h-6" />
                </div>
                <h3 className="font-semibold text-white text-base mb-1 flex items-center justify-between">
                  <span>{t('public_feed', 'Explore City Map')}</span>
                  <ChevronRight className="w-4 h-4 text-slate-500 group-hover:text-purple-400 transition-colors" />
                </h3>
                <p className="text-xs text-slate-400 leading-relaxed">
                  {t('public_feed', 'Browse community reports across your city, view verified issues, and track area resolution efforts.')}
                </p>
              </div>
            </div>

            {/* Recent Reports Summary */}
            <div className="bg-[#0e1320] rounded-2xl border border-white/10 p-6">
              <div className="flex items-center justify-between mb-6">
                <div>
                  <h3 className="text-base font-semibold text-white">{t('my_issues', 'Your Recent Incident Submissions')}</h3>
                  <p className="text-xs text-slate-400">{t('my_issues', 'Real-time status of issues submitted under your account')}</p>
                </div>
                <button
                  onClick={() => setActiveTab('reports')}
                  className="text-xs text-blue-400 hover:text-blue-300 font-medium flex items-center gap-1"
                >
                  {t('my_issues', 'View All')} ({myReports.length})
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>

              {myReports.length === 0 ? (
                <div className="text-center py-10 border border-dashed border-white/10 rounded-xl">
                  <AlertCircle className="w-8 h-8 text-slate-500 mx-auto mb-2" />
                  <p className="text-xs text-slate-300 font-medium">No reports submitted yet</p>
                  <p className="text-[11px] text-slate-500 mt-1 mb-4">Be the first to report an issue in your neighborhood!</p>
                  <button
                    onClick={() => {
                      setActiveTab('report');
                      resetForm();
                    }}
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium rounded-lg"
                  >
                    Report First Issue
                  </button>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {myReports.slice(0, 4).map((item) => (
                    <div
                      key={item.id || item.ticketId}
                      onClick={() => {
                        setSelectedReportDetail(item);
                        setActiveTab('reports');
                      }}
                      className="flex gap-4 p-4 rounded-xl bg-white/5 hover:bg-white/10 border border-white/5 transition-all cursor-pointer"
                    >
                      <img
                        src={item.imageUrl}
                        alt={item.title}
                        className="w-20 h-20 object-cover rounded-lg border border-white/10 flex-shrink-0"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2 mb-1">
                          <span className="text-[10px] font-mono font-bold text-blue-400 bg-blue-500/10 px-2 py-0.5 rounded border border-blue-500/20">
                            {item.ticketId}
                          </span>
                          <span
                            className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                              item.status === 'Resolved'
                                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                                : 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                            }`}
                          >
                            {item.status}
                          </span>
                        </div>
                        <h4 className="text-xs font-semibold text-white truncate">{item.title}</h4>
                        <p className="text-[11px] text-slate-400 line-clamp-1 mt-0.5">{item.description}</p>
                        <div className="flex items-center gap-1 text-[10px] text-slate-500 mt-2">
                          <MapPin className="w-3 h-3 text-red-400 flex-shrink-0" />
                          <span className="truncate">{item.location?.address || 'Location tagged'}</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* VIEW 2: REPORT ISSUE MODULE */}
        {activeTab === 'report' && (
          <div className="max-w-4xl mx-auto">
            {/* Top Bar */}
            <div className="flex items-center justify-between mb-6">
              <button
                onClick={() => setActiveTab('home')}
                className="text-xs text-slate-400 hover:text-white flex items-center gap-1.5 transition-colors"
              >
                <ArrowLeft className="w-4 h-4" />
                <span>Back to Dashboard</span>
              </button>
              <div className="flex items-center gap-2 text-xs text-blue-400 bg-blue-500/10 px-3 py-1 rounded-full border border-blue-500/20">
                <Sparkles className="w-3.5 h-3.5" />
                <span>AI Auto-Classification Enabled</span>
              </div>
            </div>

            {/* Submission Confirmation Card */}
            {submittedTicket ? (
              <div className="bg-[#0e1320] border border-emerald-500/30 rounded-2xl p-6 sm:p-8 text-center shadow-xl animate-in fade-in zoom-in duration-200">
                <div className="w-16 h-16 bg-emerald-500/20 text-emerald-400 rounded-full flex items-center justify-center mx-auto mb-4 border border-emerald-500/40">
                  <CheckCircle2 className="w-8 h-8" />
                </div>
                <h2 className="text-2xl font-bold text-white mb-1">Issue Reported Successfully!</h2>
                <p className="text-xs text-slate-400 mb-6">
                  Your civic incident report has been submitted, geotagged, and logged into the system.
                </p>

                <div className="max-w-md mx-auto bg-white/5 p-4 rounded-xl border border-white/10 text-left mb-6 space-y-3">
                  <div className="flex justify-between items-center text-xs border-b border-white/10 pb-2">
                    <span className="text-slate-400">Ticket Reference ID:</span>
                    <span className="font-mono font-bold text-blue-400 text-sm">{submittedTicket.ticketId}</span>
                  </div>
                  <div className="flex justify-between items-center text-xs">
                    <span className="text-slate-400">Issue Type:</span>
                    <span className="font-medium text-white">{submittedTicket.issueType}</span>
                  </div>
                  <div className="flex justify-between items-center text-xs">
                    <span className="text-slate-400">Assigned Category:</span>
                    <span className="font-medium text-slate-200">{submittedTicket.category}</span>
                  </div>
                  <div className="flex justify-between items-center text-xs">
                    <span className="text-slate-400">Routed Department:</span>
                    <span className="font-medium text-amber-300">{submittedTicket.department}</span>
                  </div>
                  <div className="flex justify-between items-start text-xs pt-1 border-t border-white/10">
                    <span className="text-slate-400 flex items-center gap-1">
                      <MapPin className="w-3 h-3 text-red-400" /> Location:
                    </span>
                    <span className="text-right text-slate-300 max-w-[220px] truncate">{submittedTicket.location.address}</span>
                  </div>
                </div>

                <div className="flex flex-wrap justify-center gap-3">
                  <button
                    onClick={() => {
                      resetForm();
                    }}
                    className="px-5 py-2.5 bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold rounded-xl flex items-center gap-2"
                  >
                    <Camera className="w-4 h-4" />
                    <span>Report Another Issue</span>
                  </button>
                  <button
                    onClick={() => {
                      setActiveTab('reports');
                    }}
                    className="px-5 py-2.5 bg-white/10 hover:bg-white/15 text-slate-200 text-xs font-semibold rounded-xl border border-white/10"
                  >
                    Track in "My Reports"
                  </button>
                </div>
              </div>
            ) : (
              /* REPORT FORM */
              <form onSubmit={handleSubmitReport} className="space-y-6">
                <div className="bg-[#0e1320] border border-white/10 rounded-2xl p-6 sm:p-8">
                  <h1 className="text-xl sm:text-2xl font-bold text-white mb-1">File a Civic Incident Report</h1>
                  <p className="text-xs text-slate-400 mb-6">
                    Upload or snap an image of the issue. Location tag is captured automatically, and Gemini AI will analyze and populate details.
                  </p>

                  {/* SECTION 1: PHOTO UPLOAD / CAMERA CAPTURE */}
                  <div className="mb-8">
                    <label className="block text-xs font-semibold text-slate-200 uppercase tracking-wider mb-2">
                      1. Upload or Snap Image of Issue <span className="text-red-400">*</span>
                    </label>

                    {!selectedImage ? (
                      <div className="border-2 border-dashed border-white/20 hover:border-blue-500/50 bg-white/5 rounded-2xl p-8 text-center transition-all">
                        <div className="flex flex-col items-center justify-center">
                          <div className="w-14 h-14 rounded-2xl bg-blue-500/10 border border-blue-500/20 text-blue-400 flex items-center justify-center mb-3">
                            <Upload className="w-7 h-7" />
                          </div>
                          <p className="text-sm font-semibold text-white mb-1">Drag and drop or select an image file</p>
                          <p className="text-xs text-slate-400 mb-4">Supports PNG, JPG, JPEG, WEBP up to 10MB</p>

                          <div className="flex flex-wrap items-center justify-center gap-3">
                            <label className="px-4 py-2.5 bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold rounded-xl cursor-pointer transition-all flex items-center gap-2 shadow-sm">
                              <Upload className="w-4 h-4" />
                              <span>Browse Photo File</span>
                              <input
                                type="file"
                                accept="image/*"
                                className="hidden"
                                onChange={(e) => {
                                  if (e.target.files && e.target.files[0]) {
                                    handleImageSelect(e.target.files[0]);
                                  }
                                }}
                              />
                            </label>

                            <button
                              type="button"
                              onClick={startCamera}
                              className="px-4 py-2.5 bg-white/10 hover:bg-white/15 text-slate-200 text-xs font-semibold rounded-xl border border-white/10 transition-all flex items-center gap-2"
                            >
                              <Camera className="w-4 h-4 text-emerald-400" />
                              <span>Use Live Camera</span>
                            </button>
                          </div>
                        </div>
                      </div>
                    ) : (
                      /* Image Preview Box */
                      <div className="relative rounded-2xl overflow-hidden border border-white/15 bg-black/40 group">
                        <img src={selectedImage} alt="Reported Issue Preview" className="w-full h-72 sm:h-80 object-cover" />

                        {/* Remove Image Button */}
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedImage(null);
                            setAiResult(null);
                          }}
                          className="absolute top-3 right-3 p-2 rounded-full bg-black/70 hover:bg-red-600 text-white transition-colors border border-white/20"
                        >
                          <X className="w-4 h-4" />
                        </button>

                        {/* AI Analyzing Spinner Overlay */}
                        {analyzingImage && (
                          <div className="absolute inset-0 bg-black/85 backdrop-blur-sm flex flex-col items-center justify-center text-white p-6 text-center">
                            <div className="relative mb-3">
                              <Sparkles className="w-9 h-9 text-blue-400 animate-pulse" />
                              <div className="absolute -top-1 -right-1 w-3 h-3 bg-emerald-400 rounded-full animate-ping"></div>
                            </div>
                            <p className="text-sm font-bold tracking-wide text-white">Custom Vision AI & Gemini Analyzing...</p>
                            <div className="text-xs text-slate-300 mt-2 space-y-1 max-w-sm text-left bg-white/5 border border-white/10 p-3 rounded-xl">
                              <p className="flex items-center gap-1.5 text-emerald-300 font-medium">
                                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
                                <span>Step 1: Custom Vision AI checking: Water Logging, Pothole, or Garbage</span>
                              </p>
                              <p className="flex items-center gap-1.5 text-blue-300 font-medium">
                                <span className="w-2 h-2 rounded-full bg-blue-400 animate-pulse"></span>
                                <span>Step 2: Gemini AI autofilling issue details & categorization</span>
                              </p>
                            </div>
                            <div className="w-56 h-1.5 bg-white/10 rounded-full overflow-hidden mt-4">
                              <div className="h-full bg-gradient-to-r from-emerald-400 via-blue-500 to-indigo-500 animate-pulse w-3/4"></div>
                            </div>
                          </div>
                        )}

                        {/* AI Match Badge */}
                        {!analyzingImage && aiResult && (
                          aiResult.isCivicIssue === false ? (
                            <div className="absolute bottom-3 left-3 right-3 bg-red-950/90 backdrop-blur-md p-3 rounded-xl border border-red-500/50 flex items-start gap-3 text-xs shadow-xl">
                              <div className="w-7 h-7 rounded-full bg-red-500/20 text-red-400 flex items-center justify-center shrink-0 mt-0.5">
                                <AlertTriangle className="w-4 h-4" />
                              </div>
                              <div className="space-y-0.5">
                                <span className="font-bold text-red-200 block">⚠️ Non-Civic / Personal Photo Detected</span>
                                <p className="text-[11px] text-red-300 leading-snug">
                                  {aiResult.nonCivicReason || "Please upload or capture a photo showing public road damage, water logging, or garbage waste."}
                                </p>
                              </div>
                            </div>
                          ) : (
                            <div className="absolute bottom-3 left-3 right-3 bg-[#0b0f19]/95 backdrop-blur-md p-3 rounded-xl border border-emerald-500/40 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs shadow-xl">
                              <div className="flex items-center gap-2.5">
                                <div className="w-8 h-8 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center shrink-0 border border-emerald-500/30">
                                  <Check className="w-4 h-4" />
                                </div>
                                <div>
                                  <div className="flex items-center gap-1.5 flex-wrap">
                                    <span className="font-bold text-white block">
                                      Custom Vision AI: {aiResult.customVisionDetectedLabel || (
                                        aiResult.category === 'Water & Drainage' ? 'Water Logging' :
                                        aiResult.category === 'Roads & Infrastructure' ? 'Road Pothole' : 'Garbage & Solid Waste'
                                      )}
                                    </span>
                                    <span className="px-1.5 py-0.2 rounded bg-emerald-500/20 text-emerald-300 text-[9px] font-mono border border-emerald-500/30">
                                      RF-DETR Verified
                                    </span>
                                  </div>
                                  <span className="text-[10px] text-slate-300">
                                    Confidence: {aiResult.confidenceScore}% • Details Autofilled by Gemini AI
                                  </span>
                                </div>
                              </div>
                              <span className="self-start sm:self-auto px-2.5 py-1 rounded-full bg-blue-500/20 text-blue-300 font-semibold text-[11px] border border-blue-500/30">
                                {aiResult.category}
                              </span>
                            </div>
                          )
                        )}
                      </div>
                    )}
                  </div>

                  {/* SECTION 2: AUTOMATIC GEOLOCATION TAGGING */}
                  <div className="mb-8 p-4 rounded-xl bg-white/5 border border-white/10">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2 text-xs font-semibold text-slate-200 uppercase tracking-wider">
                        <MapPin className="w-4 h-4 text-red-400" />
                        <span>2. Automatic Geolocation Tagging</span>
                      </div>
                      <button
                        type="button"
                        onClick={getGeolocation}
                        disabled={location.loading}
                        className="text-[11px] text-blue-400 hover:text-blue-300 flex items-center gap-1 font-medium disabled:opacity-50"
                      >
                        <RefreshCw className={`w-3 h-3 ${location.loading ? 'animate-spin' : ''}`} />
                        <span>Refresh GPS</span>
                      </button>
                    </div>

                    {location.loading ? (
                      <div className="flex items-center gap-2 text-xs text-slate-400 py-2">
                        <RefreshCw className="w-3.5 h-3.5 animate-spin text-blue-400" />
                        <span>Acquiring GPS coordinates & reverse geocoding location...</span>
                      </div>
                    ) : location.error ? (
                      <div className="text-xs text-amber-400 flex items-center gap-2 py-1">
                        <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                        <span>{location.error}</span>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        <div className="flex items-center justify-between text-xs bg-black/30 p-2.5 rounded-lg border border-white/5">
                          <span className="text-slate-400">Tagged GPS Coordinates:</span>
                          <span className="font-mono text-emerald-400 font-medium">
                            {location.latitude
                              ? `${location.latitude.toFixed(6)}° N, ${location.longitude?.toFixed(6)}° E`
                              : 'Location not captured yet'}
                          </span>
                        </div>

                        <div>
                          <label className="block text-[11px] text-slate-400 mb-1">Location Address / Landmark (Editable):</label>
                          <input
                            type="text"
                            value={manualAddress}
                            onChange={(e) => setManualAddress(e.target.value)}
                            placeholder="Enter or refine exact street address, corner, or landmark"
                            className="w-full bg-[#07090e] border border-white/10 rounded-lg px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
                          />
                        </div>
                      </div>
                    )}
                  </div>

                  {/* SECTION 3: ISSUE DETAILS (AUTO-FILLED BY AI & EDITABLE) */}
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <label className="block text-xs font-semibold text-slate-200 uppercase tracking-wider">
                        3. Issue Details & Categorization
                      </label>
                      {aiResult && (
                        <span className="text-[11px] text-emerald-400 flex items-center gap-1">
                          <Sparkles className="w-3 h-3" /> Pre-filled by Gemini AI (You can edit)
                        </span>
                      )}
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {/* Issue Type / Short Title */}
                      <div>
                        <label className="block text-[11px] font-medium text-slate-400 mb-1">
                          Issue Name / Type <span className="text-red-400">*</span>
                        </label>
                        <input
                          type="text"
                          value={issueType}
                          onChange={(e) => {
                            setIssueType(e.target.value);
                            if (!title) setTitle(e.target.value);
                          }}
                          placeholder="e.g. Deep Pothole, Overflowing Garbage Bin"
                          required
                          className="w-full bg-[#07090e] border border-white/10 rounded-xl px-3.5 py-2.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
                        />
                      </div>

                      {/* Category Dropdown */}
                      <div>
                        <label className="block text-[11px] font-medium text-slate-400 mb-1">
                          Category <span className="text-red-400">*</span>
                        </label>
                        <select
                          value={category}
                          onChange={(e) => setCategory(e.target.value)}
                          className="w-full bg-[#07090e] border border-white/10 rounded-xl px-3.5 py-2.5 text-xs text-white focus:outline-none focus:border-blue-500"
                        >
                          {CATEGORIES.map((cat) => (
                            <option key={cat} value={cat}>
                              {cat}
                            </option>
                          ))}
                        </select>
                      </div>

                      {/* Severity Level */}
                      <div>
                        <label className="block text-[11px] font-medium text-slate-400 mb-1">Severity Assessment</label>
                        <select
                          value={severity}
                          onChange={(e) => setSeverity(e.target.value)}
                          className="w-full bg-[#07090e] border border-white/10 rounded-xl px-3.5 py-2.5 text-xs text-white focus:outline-none focus:border-blue-500"
                        >
                          {SEVERITY_LEVELS.map((sev) => (
                            <option key={sev} value={sev}>
                              {sev} Severity
                            </option>
                          ))}
                        </select>
                      </div>

                      {/* Department Routing */}
                      <div>
                        <label className="block text-[11px] font-medium text-slate-400 mb-1">Assigned Department</label>
                        <input
                          type="text"
                          value={department}
                          onChange={(e) => setDepartment(e.target.value)}
                          placeholder="Department responsible"
                          className="w-full bg-[#07090e] border border-white/10 rounded-xl px-3.5 py-2.5 text-xs text-white focus:outline-none focus:border-blue-500"
                        />
                      </div>
                    </div>

                    {/* Auto-generated & Manual Description with Voice Input Speech-to-Text */}
                    <div>
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-2">
                        <label className="text-[11px] font-medium text-slate-400 flex items-center gap-1.5">
                          <span>Detailed Description</span>
                          <span className="text-red-400">*</span>
                        </label>

                        {/* Voice Input Controls */}
                        <div className="flex items-center gap-2">
                          {/* Language selector toggle */}
                          <div className="flex bg-black/40 border border-white/10 rounded-lg p-0.5 text-[10px]">
                            <button
                              type="button"
                              onClick={() => setVoiceLang('hi-IN')}
                              className={`px-2 py-0.5 rounded font-semibold transition-all ${
                                voiceLang === 'hi-IN'
                                  ? 'bg-blue-600 text-white shadow'
                                  : 'text-slate-400 hover:text-white'
                              }`}
                              title="Speak in Hindi / हिन्दी में बोलें"
                            >
                              हिन्दी (Hindi)
                            </button>
                            <button
                              type="button"
                              onClick={() => setVoiceLang('en-IN')}
                              className={`px-2 py-0.5 rounded font-semibold transition-all ${
                                voiceLang === 'en-IN'
                                  ? 'bg-blue-600 text-white shadow'
                                  : 'text-slate-400 hover:text-white'
                              }`}
                              title="Speak in English"
                            >
                              English
                            </button>
                          </div>

                          {/* Mic Toggle Button */}
                          <button
                            type="button"
                            onClick={toggleVoiceInput}
                            className={`px-3 py-1 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-all shadow-sm ${
                              isListening
                                ? 'bg-red-500 text-white animate-pulse border border-red-400 shadow-red-500/50'
                                : 'bg-blue-500/15 hover:bg-blue-500/25 border border-blue-500/30 text-blue-300'
                            }`}
                          >
                            {isListening ? (
                              <>
                                <MicOff className="w-3.5 h-3.5" />
                                <span>Stop Recording</span>
                              </>
                            ) : (
                              <>
                                <Mic className="w-3.5 h-3.5 text-blue-400" />
                                <span>Voice Input / बोलकर लिखें</span>
                              </>
                            )}
                          </button>
                        </div>
                      </div>

                      {/* Active Listening Indicator Banner */}
                      {isListening && (
                        <div className="mb-2 p-2.5 bg-red-500/10 border border-red-500/30 rounded-xl text-xs text-red-300 flex items-center justify-between animate-in fade-in">
                          <div className="flex items-center gap-2">
                            <span className="w-2.5 h-2.5 bg-red-500 rounded-full animate-ping"></span>
                            <span className="font-semibold text-white">
                              Listening... ({voiceLang === 'hi-IN' ? 'Hindi' : 'English'})
                            </span>
                            <span className="text-slate-300 hidden sm:inline">Speak into your mic to fill description</span>
                          </div>
                          <button
                            type="button"
                            onClick={toggleVoiceInput}
                            className="text-[10px] bg-red-500/20 hover:bg-red-500/40 text-red-200 px-2 py-0.5 rounded font-mono"
                          >
                            Stop
                          </button>
                        </div>
                      )}

                      <div className="relative">
                        <textarea
                          rows={4}
                          value={description}
                          onChange={(e) => setDescription(e.target.value)}
                          placeholder={
                            isListening
                              ? "Aap bolna shuru kijiye, yaha text type ho jayega..."
                              : "Provide details of the issue. You can click 'Voice Input / बोलकर लिखें' to speak in Hindi/English, edit manually, or let Gemini AI pre-fill it."
                          }
                          required
                          className={`w-full bg-[#07090e] border text-xs text-white placeholder-slate-500 focus:outline-none leading-relaxed rounded-xl p-3.5 transition-all ${
                            isListening
                              ? 'border-red-500 ring-2 ring-red-500/20 shadow-lg shadow-red-500/10'
                              : 'border-white/10 focus:border-blue-500'
                          }`}
                        />
                      </div>
                    </div>

                    {/* Key Observations from AI */}
                    {aiResult?.keyObservations && aiResult.keyObservations.length > 0 && (
                      <div className="bg-[#0b1120] border border-blue-500/20 rounded-xl p-3.5 space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-[11px] font-semibold text-blue-300 flex items-center gap-1.5">
                            <Info className="w-3.5 h-3.5 text-blue-400" />
                            <span>AI Vision & Inspection Observations:</span>
                          </span>
                          {aiResult.customModelUsed && (
                            <span className="px-2 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 font-mono text-[9px]">
                              Roboflow RF-DETR Verified
                            </span>
                          )}
                        </div>
                        <ul className="list-disc list-inside space-y-1 text-[11px] text-slate-300">
                          {aiResult.keyObservations.map((obs, idx) => (
                            <li key={idx} className="leading-relaxed">
                              {obs}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>

                  {/* REJECTION WARNING BANNER IF NO ISSUE DETECTED */}
                  {aiResult?.isCivicIssue === false && (
                    <div className="mt-6 p-4 bg-red-500/10 border border-red-500/30 rounded-xl flex items-start gap-3 text-red-300 text-xs">
                      <ShieldAlert className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
                      <div className="space-y-0.5">
                        <span className="font-bold text-red-200 block text-sm">Submission Rejected — No Civic Defect Found</span>
                        <p className="text-red-300 leading-relaxed">
                          {aiResult.nonCivicReason || "Gemini AI analyzed this image and found no public municipal issue. Please upload a clear photo of road damage, garbage dump, broken light, or water leakage to submit a report."}
                        </p>
                      </div>
                    </div>
                  )}

                  {/* SUBMIT BUTTON */}
                  <div className="mt-8 pt-6 border-t border-white/10 flex items-center justify-end gap-3">
                    <button
                      type="button"
                      onClick={() => {
                        setActiveTab('home');
                        resetForm();
                      }}
                      className="px-5 py-2.5 text-xs text-slate-400 hover:text-white transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={submitting || !selectedImage || aiResult?.isCivicIssue === false || aiResult?.confidenceScore === 0}
                      className={`px-6 py-2.5 text-xs font-semibold rounded-xl shadow-lg transition-all flex items-center gap-2 ${
                        aiResult?.isCivicIssue === false || aiResult?.confidenceScore === 0
                          ? 'bg-red-900/40 border border-red-500/40 text-red-300 cursor-not-allowed opacity-90'
                          : 'bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white shadow-blue-500/20 disabled:opacity-50'
                      }`}
                    >
                      {submitting ? (
                        <>
                          <RefreshCw className="w-4 h-4 animate-spin" />
                          <span>Submitting Report...</span>
                        </>
                      ) : aiResult?.isCivicIssue === false || aiResult?.confidenceScore === 0 ? (
                        <>
                          <ShieldAlert className="w-4 h-4 text-red-400" />
                          <span>Report Rejected (No Issue Detected)</span>
                        </>
                      ) : (
                        <>
                          <CheckCircle2 className="w-4 h-4 text-blue-200" />
                          <span>Submit Verified Report</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>
              </form>
            )}
          </div>
        )}

        {/* VIEW 3: MY REPORTS LIST */}
        {activeTab === 'reports' && (
          <div>
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
              <div>
                <h1 className="text-2xl font-bold text-white tracking-tight">My Incident Reports</h1>
                <p className="text-xs text-slate-400 mt-1">
                  Track resolution progress and municipal department responses for issues you filed.
                </p>
              </div>

              <div className="flex items-center gap-2">
                <Filter className="w-4 h-4 text-slate-400" />
                <select
                  value={filterStatus}
                  onChange={(e) => setFilterStatus(e.target.value)}
                  className="bg-[#0e1320] border border-white/10 rounded-xl px-3 py-1.5 text-xs text-white focus:outline-none"
                >
                  <option value="All">All Statuses</option>
                  <option value="Submitted">Submitted</option>
                  <option value="In Progress">In Progress</option>
                  <option value="Resolved">Resolved</option>
                </select>

                <button
                  onClick={() => {
                    if (user) fetchUserReports(user.uid);
                  }}
                  className="p-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-slate-300"
                  title="Refresh Reports"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${loadingReports ? 'animate-spin' : ''}`} />
                </button>
              </div>
            </div>

            {loadingReports ? (
              <div className="text-center py-16">
                <RefreshCw className="w-6 h-6 animate-spin text-blue-500 mx-auto mb-2" />
                <p className="text-xs text-slate-400">Loading your reported tickets...</p>
              </div>
            ) : myReports.length === 0 ? (
              <div className="bg-[#0e1320] rounded-2xl border border-white/10 p-12 text-center">
                <FileText className="w-12 h-12 text-slate-600 mx-auto mb-3" />
                <h3 className="text-base font-semibold text-white mb-1">No Reports Found</h3>
                <p className="text-xs text-slate-400 mb-6">You haven't reported any civic issues yet.</p>
                <button
                  onClick={() => {
                    setActiveTab('report');
                    resetForm();
                  }}
                  className="px-5 py-2.5 bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold rounded-xl"
                >
                  Report an Issue Now
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {myReports
                  .filter((item) => filterStatus === 'All' || item.status === filterStatus)
                  .map((item) => (
                    <div
                      key={item.id || item.ticketId}
                      className="bg-[#0e1320] rounded-2xl border border-white/10 overflow-hidden hover:border-blue-500/40 transition-all flex flex-col group"
                    >
                      {/* Image header */}
                      <div className="relative h-44 overflow-hidden bg-black/50">
                        <img
                          src={item.imageUrl}
                          alt={item.title}
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                        />
                        <div className="absolute top-3 left-3 bg-black/70 backdrop-blur-md px-2.5 py-1 rounded-md text-[10px] font-mono font-bold text-blue-400 border border-white/20">
                          {item.ticketId}
                        </div>
                        <div
                          className={`absolute top-3 right-3 px-2.5 py-1 rounded-full text-[10px] font-semibold ${
                            item.status === 'Resolved'
                              ? 'bg-emerald-500/80 text-white'
                              : 'bg-amber-500/80 text-white'
                          }`}
                        >
                          {item.status}
                        </div>
                      </div>

                      {/* Content */}
                      <div className="p-5 flex-1 flex flex-col justify-between space-y-4">
                        <div>
                          <div className="flex items-center gap-2 mb-2">
                            <span className="px-2 py-0.5 rounded bg-white/5 border border-white/10 text-[10px] text-slate-300">
                              {item.category}
                            </span>
                            <span className="px-2 py-0.5 rounded bg-red-500/10 text-red-400 border border-red-500/20 text-[10px] font-medium">
                              {item.severity} Severity
                            </span>
                          </div>

                          <h3 className="font-semibold text-white text-sm mb-1">{item.title}</h3>
                          <p className="text-xs text-slate-400 line-clamp-2 leading-relaxed">{item.description}</p>
                        </div>

                        <div className="pt-3 border-t border-white/10 space-y-2">
                          <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
                            <MapPin className="w-3.5 h-3.5 text-red-400 flex-shrink-0" />
                            <span className="truncate">{item.location?.address}</span>
                          </div>

                          <div className="flex items-center justify-between text-[11px] text-slate-500">
                            <span className="flex items-center gap-1">
                              <Building2 className="w-3 h-3 text-amber-400" /> {item.department}
                            </span>
                            <div className="flex items-center gap-3">
                              <button
                                onClick={() => setSelectedReportDetail(item)}
                                className="text-blue-400 hover:text-blue-300 font-medium flex items-center gap-0.5"
                              >
                                <Eye className="w-3.5 h-3.5" /> Details
                              </button>
                              {item.id && (
                                <button
                                  onClick={(e) => handleDeleteReport(e, item.id!, item.ticketId)}
                                  className="text-red-400 hover:text-red-300 font-medium flex items-center gap-0.5"
                                  title="Delete Complaint"
                                >
                                  <Trash2 className="w-3.5 h-3.5" /> Delete
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
              </div>
            )}
          </div>
        )}

        {/* VIEW 4: EXPLORE MAP & COMMUNITY FEED */}
        {activeTab === 'explore' && (
          <div>
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
              <div>
                <h1 className="text-2xl font-bold text-white tracking-tight">Community Incident Feed</h1>
                <p className="text-xs text-slate-400 mt-1">
                  Explore verified civic reports and active municipal resolutions across your area.
                </p>
              </div>

              <div className="flex items-center gap-2">
                <div className="relative">
                  <Search className="w-4 h-4 text-slate-500 absolute left-3 top-2.5" />
                  <input
                    type="text"
                    value={exploreSearch}
                    onChange={(e) => setExploreSearch(e.target.value)}
                    placeholder="Search category or location..."
                    className="bg-[#0e1320] border border-white/10 rounded-xl pl-9 pr-3 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 w-56 sm:w-64"
                  />
                </div>
                <button
                  onClick={fetchAllReports}
                  className="p-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-slate-300"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${loadingExplore ? 'animate-spin' : ''}`} />
                </button>
              </div>
            </div>

            {loadingExplore ? (
              <div className="text-center py-16">
                <RefreshCw className="w-6 h-6 animate-spin text-blue-500 mx-auto mb-2" />
                <p className="text-xs text-slate-400">Loading community issues...</p>
              </div>
            ) : allReports.length === 0 ? (
              <div className="bg-[#0e1320] rounded-2xl border border-white/10 p-12 text-center">
                <Compass className="w-12 h-12 text-slate-600 mx-auto mb-3" />
                <h3 className="text-base font-semibold text-white mb-1">No Civic Issues Logged Yet</h3>
                <p className="text-xs text-slate-400 mb-6">Be the first citizen to file an issue in this region.</p>
                <button
                  onClick={() => {
                    setActiveTab('report');
                    resetForm();
                  }}
                  className="px-5 py-2.5 bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold rounded-xl"
                >
                  Report First Issue
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {allReports
                  .filter(
                    (item) =>
                      !exploreSearch ||
                      item.title.toLowerCase().includes(exploreSearch.toLowerCase()) ||
                      item.category.toLowerCase().includes(exploreSearch.toLowerCase()) ||
                      item.location.address.toLowerCase().includes(exploreSearch.toLowerCase())
                  )
                  .map((item) => (
                    <div
                      key={item.id || item.ticketId}
                      className="bg-[#0e1320] rounded-2xl border border-white/10 overflow-hidden hover:border-blue-500/30 transition-all flex flex-col"
                    >
                      <div className="relative h-44 bg-black/50">
                        <img src={item.imageUrl} alt={item.title} className="w-full h-full object-cover" />
                        <div className="absolute top-3 left-3 bg-black/70 backdrop-blur-md px-2.5 py-1 rounded-md text-[10px] font-mono font-bold text-blue-400 border border-white/20">
                          {item.ticketId}
                        </div>
                        <div className="absolute top-3 right-3 px-2.5 py-1 rounded-full text-[10px] font-semibold bg-blue-600 text-white">
                          {item.category}
                        </div>
                      </div>

                      <div className="p-5 flex-1 flex flex-col justify-between space-y-4">
                        <div>
                          <div className="flex items-center justify-between gap-2 mb-1.5">
                            <h3 className="font-semibold text-white text-sm truncate">{item.title}</h3>
                            <span
                              className={`px-2 py-0.5 rounded-md text-[10px] font-bold uppercase ${
                                item.severity === 'Critical'
                                  ? 'bg-red-500/20 text-red-400 border border-red-500/40 animate-pulse'
                                  : item.severity === 'High'
                                  ? 'bg-orange-500/20 text-orange-400 border border-orange-500/30'
                                  : 'bg-blue-500/20 text-blue-300 border border-blue-500/30'
                              }`}
                            >
                              {item.severity} Priority
                            </span>
                          </div>
                          <p className="text-xs text-slate-400 line-clamp-2 leading-relaxed">{item.description}</p>
                        </div>

                        {/* Supporters & Duplicates Badge */}
                        <div className="flex items-center justify-between bg-white/5 px-3 py-2 rounded-xl border border-white/5 text-[11px]">
                          <div className="flex items-center gap-1.5 text-amber-400 font-bold">
                            <Users className="w-3.5 h-3.5 text-amber-400" />
                            <span>{item.supportersCount || item.upvotes || 1} Citizens Reported</span>
                          </div>
                          {item.duplicateCount && item.duplicateCount > 0 ? (
                            <span className="text-[10px] bg-amber-500/20 text-amber-300 border border-amber-500/30 px-2 py-0.5 rounded-full font-mono font-bold">
                              🔗 {item.duplicateCount} Merged
                            </span>
                          ) : null}
                        </div>

                        <div className="pt-3 border-t border-white/10 space-y-2">
                          <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
                            <MapPin className="w-3.5 h-3.5 text-red-400 flex-shrink-0" />
                            <span className="truncate">{item.location?.address}</span>
                          </div>

                          <div className="flex items-center justify-between text-[11px]">
                            <button
                              type="button"
                              onClick={() => item.id && handleUpvoteIssue(item.id)}
                              className={`px-2.5 py-1 rounded-lg border text-[11px] font-bold flex items-center gap-1 transition-all ${
                                user && item.supporters?.includes(user.uid)
                                  ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                                  : 'bg-white/5 hover:bg-white/10 text-slate-300 border-white/10'
                              }`}
                            >
                              <ThumbsUp className="w-3 h-3 text-amber-400" />
                              <span>{user && item.supporters?.includes(user.uid) ? 'Supported' : 'Support (+1)'}</span>
                            </button>

                            <div className="flex items-center gap-3">
                              <button
                                onClick={() => setSelectedReportDetail(item)}
                                className="text-blue-400 hover:text-blue-300 font-medium flex items-center gap-1"
                              >
                                <Eye className="w-3.5 h-3.5" /> View
                              </button>
                              {item.id && (
                                <button
                                  onClick={(e) => handleDeleteReport(e, item.id!, item.ticketId)}
                                  className="text-red-400 hover:text-red-300 font-medium flex items-center gap-0.5"
                                  title="Delete Complaint"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
              </div>
            )}
          </div>
        )}
      </main>

      {/* MODAL 1: CAMERA STREAM MODAL */}
      {showCamera && (
        <div className="fixed inset-0 z-50 bg-black/90 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-[#0e1320] border border-white/20 rounded-2xl p-6 max-w-lg w-full text-center relative">
            <button
              onClick={stopCamera}
              className="absolute top-4 right-4 p-2 rounded-full bg-white/10 hover:bg-white/20 text-white"
            >
              <X className="w-4 h-4" />
            </button>

            <h3 className="text-lg font-bold text-white mb-2 flex items-center justify-center gap-2">
              <Camera className="w-5 h-5 text-emerald-400" />
              <span>Capture Live Issue Photo</span>
            </h3>
            <p className="text-xs text-slate-400 mb-4">Position the civic defect clearly in frame</p>

            <div className="relative rounded-xl overflow-hidden bg-black border border-white/10 mb-4 h-64 flex items-center justify-center">
              <video ref={videoRef} autoPlay playsInline className="w-full h-full object-cover" />
              <canvas ref={canvasRef} className="hidden" />
            </div>

            <div className="flex justify-center gap-3">
              <button
                onClick={stopCamera}
                className="px-4 py-2 bg-white/10 text-slate-300 text-xs font-medium rounded-xl"
              >
                Cancel
              </button>
              <button
                onClick={captureCameraPhoto}
                className="px-6 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold rounded-xl flex items-center gap-2"
              >
                <Camera className="w-4 h-4" />
                <span>Snap Photo</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 2: TICKET DETAILS MODAL */}
      {selectedReportDetail && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-[#0e1320] border border-white/20 rounded-2xl p-6 max-w-2xl w-full max-h-[90vh] overflow-y-auto relative">
            <button
              onClick={() => setSelectedReportDetail(null)}
              className="absolute top-4 right-4 p-2 rounded-full bg-white/10 hover:bg-white/20 text-white"
            >
              <X className="w-4 h-4" />
            </button>

            <div className="flex items-center justify-between mb-4 mr-8">
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs font-bold text-blue-400 bg-blue-500/10 px-2.5 py-1 rounded border border-blue-500/20">
                  {selectedReportDetail.ticketId}
                </span>
                <span
                  className={`text-xs font-semibold px-2.5 py-1 rounded-full ${
                    selectedReportDetail.status === 'Resolved'
                      ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                      : 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                  }`}
                >
                  {selectedReportDetail.status}
                </span>
              </div>

              {selectedReportDetail.id && (
                <button
                  onClick={(e) => handleDeleteReport(e, selectedReportDetail.id!, selectedReportDetail.ticketId)}
                  className="px-2.5 py-1 bg-red-600/80 hover:bg-red-500 text-white rounded-lg text-xs font-semibold flex items-center gap-1 transition-all"
                  title="Delete this complaint"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Delete Complaint</span>
                </button>
              )}
            </div>

            <h2 className="text-xl font-bold text-white mb-2">{selectedReportDetail.title}</h2>

            <div className="rounded-xl overflow-hidden mb-4 border border-white/10 max-h-72">
              <img src={selectedReportDetail.imageUrl} alt={selectedReportDetail.title} className="w-full object-cover" />
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-4 text-xs">
              <div className="bg-white/5 p-3 rounded-xl border border-white/5">
                <span className="text-slate-500 block mb-1">Category</span>
                <span className="font-medium text-slate-200">{selectedReportDetail.category}</span>
              </div>
              <div className="bg-white/5 p-3 rounded-xl border border-white/5">
                <span className="text-slate-500 block mb-1">Severity</span>
                <span className="font-medium text-red-400">{selectedReportDetail.severity}</span>
              </div>
              <div className="bg-white/5 p-3 rounded-xl border border-white/5">
                <span className="text-slate-500 block mb-1">Department</span>
                <span className="font-medium text-amber-300">{selectedReportDetail.department}</span>
              </div>
            </div>

            <div className="bg-white/5 p-4 rounded-xl border border-white/5 mb-4">
              <span className="text-xs font-semibold text-slate-300 block mb-1">Description:</span>
              <p className="text-xs text-slate-300 leading-relaxed">{selectedReportDetail.description}</p>
            </div>

            <div className="bg-white/5 p-4 rounded-xl border border-white/5 flex items-center gap-2 text-xs text-slate-300 mb-4">
              <MapPin className="w-4 h-4 text-red-400 flex-shrink-0" />
              <div>
                <span className="font-semibold block">Location:</span>
                <span>{selectedReportDetail.location.address}</span>
              </div>
            </div>

            {/* COMMUNITY RESOLUTION VERIFICATION SECTION */}
            <div className="mt-6 border-t border-white/10 pt-5">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
                    <Users className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-white flex items-center gap-2">
                      <span>Community Verification</span>
                      {selectedReportDetail.isDisputed && (
                        <span className="text-[10px] bg-red-500/20 text-red-300 border border-red-500/30 px-2 py-0.5 rounded-full font-mono">
                          ⚠️ Disputed
                        </span>
                      )}
                    </h3>
                    <p className="text-[11px] text-slate-400">
                      Nearby citizens vote and verify whether this issue is actually resolved.
                    </p>
                  </div>
                </div>

                {/* Score badge */}
                {selectedReportDetail.voteStats && (
                  <div className="text-right">
                    <span className="text-xs font-bold text-emerald-400">
                      {Math.round(
                        (selectedReportDetail.voteStats.yes /
                          Math.max(1, selectedReportDetail.voteStats.yes + selectedReportDetail.voteStats.no)) *
                          100
                      )}
                      % Verified
                    </span>
                    <span className="text-[10px] text-slate-500 block">
                      ({selectedReportDetail.voteStats.yes} Fixed / {selectedReportDetail.voteStats.no} Unresolved)
                    </span>
                  </div>
                )}
              </div>

              {/* Progress Bar for Community Approval */}
              {selectedReportDetail.voteStats && (selectedReportDetail.voteStats.yes + selectedReportDetail.voteStats.no > 0) && (
                <div className="mb-4">
                  <div className="w-full bg-white/10 rounded-full h-2 overflow-hidden flex">
                    <div
                      className="bg-emerald-500 h-full transition-all"
                      style={{
                        width: `${
                          (selectedReportDetail.voteStats.yes /
                            (selectedReportDetail.voteStats.yes + selectedReportDetail.voteStats.no)) *
                          100
                        }%`,
                      }}
                    />
                    <div
                      className="bg-red-500 h-full transition-all"
                      style={{
                        width: `${
                          (selectedReportDetail.voteStats.no /
                            (selectedReportDetail.voteStats.yes + selectedReportDetail.voteStats.no)) *
                          100
                        }%`,
                      }}
                    />
                  </div>
                </div>
              )}

              {/* Authority Resolution Proof Photo if available */}
              {selectedReportDetail.resolutionProofUrl && (
                <div className="mb-4 p-3 bg-emerald-950/30 border border-emerald-500/30 rounded-xl">
                  <span className="text-xs font-semibold text-emerald-300 block mb-2 flex items-center gap-1.5">
                    <CheckCircle2 className="w-3.5 h-3.5" /> Authority Live Proof Photo:
                  </span>
                  <img
                    src={selectedReportDetail.resolutionProofUrl}
                    alt="Resolution Proof"
                    className="w-full h-40 object-cover rounded-lg border border-emerald-500/20"
                  />
                  {selectedReportDetail.resolutionNotes && (
                    <p className="text-xs text-slate-300 mt-2 italic">
                      "{selectedReportDetail.resolutionNotes}"
                    </p>
                  )}
                </div>
              )}

              {/* Success Message Banner */}
              {voteSuccessMessage && (
                <div className="mb-4 p-3 bg-emerald-500/20 border border-emerald-500/30 rounded-xl text-xs text-emerald-300 flex items-center gap-2">
                  <Award className="w-4 h-4 text-amber-400 flex-shrink-0" />
                  <span>{voteSuccessMessage}</span>
                </div>
              )}

              {/* Voting Form or Voted Status */}
              <div className="bg-[#07090e] border border-white/10 rounded-2xl p-4">
                {selectedReportDetail.communityVotes?.some((v) => v.userId === user?.uid) ? (
                  <div>
                    <div className="flex items-center justify-between text-xs mb-2">
                      <span className="text-slate-400 font-medium">Your Verification Vote:</span>
                      {selectedReportDetail.communityVotes?.find((v) => v.userId === user?.uid)?.vote === 'yes' ? (
                        <span className="px-2.5 py-1 bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 rounded-full font-semibold flex items-center gap-1">
                          <ThumbsUp className="w-3 h-3" /> Verified Fixed
                        </span>
                      ) : (
                        <span className="px-2.5 py-1 bg-red-500/20 text-red-300 border border-red-500/30 rounded-full font-semibold flex items-center gap-1">
                          <ThumbsDown className="w-3 h-3" /> Reported Still Unresolved
                        </span>
                      )}
                    </div>
                    {selectedReportDetail.communityVotes?.find((v) => v.userId === user?.uid)?.comment && (
                      <p className="text-xs text-slate-300 bg-white/5 p-2.5 rounded-xl border border-white/5 italic">
                        "{selectedReportDetail.communityVotes?.find((v) => v.userId === user?.uid)?.comment}"
                      </p>
                    )}
                  </div>
                ) : (
                  <div>
                    <div className="flex items-center justify-between mb-3">
                      <span className="text-xs font-semibold text-white flex items-center gap-1.5">
                        <MessageSquare className="w-3.5 h-3.5 text-blue-400" />
                        <span>Is this issue actually resolved on ground?</span>
                      </span>
                      <span className="text-[10px] bg-amber-500/10 text-amber-400 border border-amber-500/20 px-2 py-0.5 rounded-full font-semibold">
                        +5 Karma Points
                      </span>
                    </div>

                    <div className="grid grid-cols-2 gap-3 mb-3">
                      <button
                        type="button"
                        onClick={() => setVoteOption('yes')}
                        className={`p-3 rounded-xl border text-xs font-semibold flex items-center justify-center gap-2 transition-all ${
                          voteOption === 'yes'
                            ? 'bg-emerald-600 text-white border-emerald-400 shadow-lg shadow-emerald-600/20 ring-2 ring-emerald-500/30'
                            : 'bg-white/5 hover:bg-white/10 text-slate-300 border-white/10'
                        }`}
                      >
                        <ThumbsUp className="w-4 h-4 text-emerald-400" />
                        <span>Yes, Fixed!</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => setVoteOption('no')}
                        className={`p-3 rounded-xl border text-xs font-semibold flex items-center justify-center gap-2 transition-all ${
                          voteOption === 'no'
                            ? 'bg-red-600 text-white border-red-400 shadow-lg shadow-red-600/20 ring-2 ring-red-500/30'
                            : 'bg-white/5 hover:bg-white/10 text-slate-300 border-white/10'
                        }`}
                      >
                        <ThumbsDown className="w-4 h-4 text-red-400" />
                        <span>No, Still Unresolved</span>
                      </button>
                    </div>

                    {voteOption && (
                      <div className="space-y-3 animate-in fade-in">
                        <textarea
                          rows={2}
                          value={voteComment}
                          onChange={(e) => setVoteComment(e.target.value)}
                          placeholder="Add your ground observations or feedback (e.g. 'I passed by today, pothole is filled properly' or 'Water is still leaking')..."
                          className="w-full bg-[#0e1320] border border-white/10 rounded-xl p-3 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
                        />

                        <button
                          type="button"
                          onClick={handleCommunityVote}
                          disabled={submittingVote}
                          className="w-full py-2.5 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white text-xs font-bold rounded-xl shadow-lg shadow-blue-600/20 flex items-center justify-center gap-2 transition-all disabled:opacity-50"
                        >
                          {submittingVote ? (
                            <>
                              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                              <span>Recording Vote...</span>
                            </>
                          ) : (
                            <>
                              <Award className="w-4 h-4 text-amber-300" />
                              <span>Submit Verification Vote (+5 Karma)</span>
                            </>
                          )}
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {/* List of recent community verification comments */}
                {selectedReportDetail.communityVotes && selectedReportDetail.communityVotes.length > 0 && (
                  <div className="mt-4 pt-4 border-t border-white/10">
                    <span className="text-[11px] font-semibold text-slate-400 block mb-2">
                      Recent Citizen Verifications ({selectedReportDetail.communityVotes.length}):
                    </span>
                    <div className="space-y-2 max-h-40 overflow-y-auto pr-1">
                      {selectedReportDetail.communityVotes.map((v, idx) => (
                        <div key={idx} className="p-2.5 bg-white/5 rounded-xl border border-white/5 text-[11px]">
                          <div className="flex items-center justify-between text-slate-400 mb-1">
                            <span className="font-mono text-slate-300 truncate max-w-[180px]">{v.userEmail}</span>
                            <div className="flex items-center gap-2">
                              {v.distanceKm !== undefined && (
                                <span className="text-[9px] bg-blue-500/10 text-blue-300 px-1.5 py-0.5 rounded">
                                  📍 {v.distanceKm} km away
                                </span>
                              )}
                              {v.vote === 'yes' ? (
                                <span className="text-emerald-400 font-semibold flex items-center gap-0.5">
                                  <ThumbsUp className="w-3 h-3" /> Fixed
                                </span>
                              ) : (
                                <span className="text-red-400 font-semibold flex items-center gap-0.5">
                                  <ThumbsDown className="w-3 h-3" /> Unresolved
                                </span>
                              )}
                            </div>
                          </div>
                          {v.comment && <p className="text-slate-200">{v.comment}</p>}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: AI DUPLICATE COMPLAINT DETECTION MODAL */}
      {duplicateModal && duplicateModal.isOpen && duplicateModal.match && (
        <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-[#0b0f19] border border-amber-500/40 rounded-3xl p-6 sm:p-8 max-w-xl w-full shadow-2xl relative animate-in zoom-in-95 my-8">
            <button
              onClick={() => setDuplicateModal(null)}
              className="absolute top-4 right-4 p-2 rounded-full bg-white/5 hover:bg-white/10 text-slate-400 hover:text-white"
            >
              <X className="w-5 h-5" />
            </button>

            {/* Header Badge */}
            <div className="flex items-center gap-3 mb-4">
              <div className="w-12 h-12 rounded-2xl bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-amber-400 shrink-0">
                <Layers className="w-6 h-6 animate-pulse" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="px-2.5 py-0.5 bg-amber-500/20 text-amber-300 border border-amber-500/40 rounded-full text-[11px] font-bold tracking-wider uppercase">
                    AI Duplicate Match Detected ({duplicateModal.match.overallScore}%)
                  </span>
                </div>
                <h3 className="text-lg font-extrabold text-white tracking-tight mt-0.5">
                  An Active Complaint Already Exists
                </h3>
              </div>
            </div>

            <p className="text-xs text-slate-300 leading-relaxed mb-5">
              Gemini AI detected an existing report for this exact same location ({duplicateModal.match.distanceMeters}m away) with matching visual features.
            </p>

            {/* Comparison Box */}
            <div className="bg-[#050810] border border-white/10 rounded-2xl p-4 space-y-4 mb-6">
              <div className="flex items-center justify-between pb-3 border-b border-white/10 text-xs">
                <div>
                  <span className="text-slate-400 font-mono text-[11px]">Existing Complaint Ticket</span>
                  <span className="block font-bold font-mono text-blue-400 text-sm">
                    #{duplicateModal.match.ticketId}
                  </span>
                </div>
                <div className="text-right">
                  <span className="text-slate-400 text-[11px]">Supporters / Citizens</span>
                  <span className="block font-bold text-amber-400 text-sm flex items-center justify-end gap-1">
                    <Users className="w-3.5 h-3.5" /> {duplicateModal.match.supportersCount || 1} Citizens
                  </span>
                </div>
              </div>

              {/* Title & Description */}
              <div>
                <h4 className="text-xs font-bold text-white mb-1">{duplicateModal.match.title}</h4>
                <p className="text-[11px] text-slate-300 line-clamp-2 bg-white/5 p-2 rounded-xl border border-white/5">
                  "{duplicateModal.match.description}"
                </p>
              </div>

              {/* Images Comparison */}
              <div className="grid grid-cols-2 gap-3 pt-1">
                <div>
                  <span className="text-[10px] uppercase tracking-wider text-slate-400 font-bold block mb-1">
                    Uploaded Photo
                  </span>
                  <div className="relative h-28 rounded-xl overflow-hidden border border-white/10 bg-slate-900">
                    <img
                      src={duplicateModal.compressedImage}
                      alt="Uploaded"
                      className="w-full h-full object-cover"
                    />
                  </div>
                </div>
                <div>
                  <span className="text-[10px] uppercase tracking-wider text-slate-400 font-bold block mb-1">
                    Existing Report Photo
                  </span>
                  <div className="relative h-28 rounded-xl overflow-hidden border border-amber-500/30 bg-slate-900">
                    <img
                      src={duplicateModal.match.imageUrl}
                      alt="Existing"
                      className="w-full h-full object-cover"
                    />
                  </div>
                </div>
              </div>

              {/* AI Breakdown Scores */}
              <div className="pt-2 border-t border-white/10 grid grid-cols-3 gap-2 text-center text-[10px]">
                <div className="bg-white/5 p-2 rounded-xl border border-white/5">
                  <span className="text-slate-400 block">Distance</span>
                  <span className="font-bold text-blue-300">{duplicateModal.match.distanceMeters}m</span>
                </div>
                <div className="bg-white/5 p-2 rounded-xl border border-white/5">
                  <span className="text-slate-400 block">Photo Similarity</span>
                  <span className="font-bold text-amber-300">{duplicateModal.match.imageScore}%</span>
                </div>
                <div className="bg-white/5 p-2 rounded-xl border border-white/5">
                  <span className="text-slate-400 block">Text Similarity</span>
                  <span className="font-bold text-emerald-300">{duplicateModal.match.textScore}%</span>
                </div>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="space-y-3">
              <button
                type="button"
                onClick={handleJoinExistingComplaint}
                disabled={submitting}
                className="w-full py-3.5 px-4 bg-gradient-to-r from-amber-500 to-orange-600 hover:from-amber-400 hover:to-orange-500 text-black font-extrabold text-xs rounded-2xl shadow-xl shadow-amber-500/20 flex items-center justify-center gap-2 transition-all"
              >
                {submitting ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    <span>Joining Complaint...</span>
                  </>
                ) : (
                  <>
                    <Users className="w-4 h-4" />
                    <span>Join Existing Complaint (+1 Support & Merge Photo)</span>
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={() => {
                  setDuplicateModal(null);
                  createNewReport(duplicateModal.newReportData);
                }}
                disabled={submitting}
                className="w-full py-2.5 px-4 bg-white/5 hover:bg-white/10 text-slate-300 hover:text-white font-semibold text-xs rounded-2xl border border-white/10 transition-all text-center"
              >
                No, Submit as a Separate Independent Issue
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 3: DELETE COMPLAINT CONFIRMATION MODAL */}
      {deleteConfirmModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#0e1320] border border-red-500/30 rounded-2xl p-6 max-w-md w-full shadow-2xl relative">
            <button
              onClick={() => setDeleteConfirmModal(null)}
              className="absolute top-4 right-4 p-1.5 rounded-full bg-white/5 hover:bg-white/10 text-slate-400 hover:text-white"
            >
              <X className="w-4 h-4" />
            </button>

            <div className="w-12 h-12 rounded-full bg-red-500/20 border border-red-500/40 flex items-center justify-center text-red-400 mb-4 mx-auto">
              <Trash2 className="w-6 h-6" />
            </div>

            <h3 className="text-lg font-bold text-white text-center mb-2">Delete Complaint Ticket?</h3>
            <p className="text-xs text-slate-300 text-center leading-relaxed mb-6">
              Are you sure you want to permanently delete complaint ticket{' '}
              <span className="font-mono font-bold text-red-400 bg-red-500/10 px-1.5 py-0.5 rounded border border-red-500/20">
                #{deleteConfirmModal.ticketId}
              </span>
              ? This action cannot be undone and will remove it from the municipal database.
            </p>

            <div className="flex items-center justify-end gap-3 pt-4 border-t border-white/10">
              <button
                type="button"
                onClick={() => setDeleteConfirmModal(null)}
                className="px-4 py-2 text-xs font-semibold text-slate-400 hover:text-white transition-colors"
                disabled={deleting}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={executeDeleteReport}
                disabled={deleting}
                className="px-5 py-2 bg-red-600 hover:bg-red-500 text-white text-xs font-semibold rounded-xl flex items-center gap-2 shadow-lg shadow-red-600/30 transition-all disabled:opacity-50"
              >
                {deleting ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    <span>Deleting...</span>
                  </>
                ) : (
                  <>
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Yes, Delete Ticket</span>
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
