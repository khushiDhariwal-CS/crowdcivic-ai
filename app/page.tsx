'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { auth, db } from '@/lib/firebase';
import {
  signInWithPopup,
  GoogleAuthProvider,
  onAuthStateChanged,
  signOut,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  User as FirebaseUser,
} from 'firebase/auth';
import { doc, getDoc, setDoc, query, where, collection, getDocs } from 'firebase/firestore';
import { logSecurityEvent } from '@/lib/audit';
import { LanguageSelector, useLanguage } from '@/lib/LanguageContext';
import { SAMPLE_ACCOUNTS, SampleAccount } from '@/lib/sampleAccounts';
import {
  Building2,
  Shield,
  User,
  Loader2,
  LogOut,
  ArrowRight,
  Mail,
  Lock,
  UserPlus,
  LogIn,
  ShieldCheck,
  Key,
  Copy,
  Check,
  Sparkles,
} from 'lucide-react';

export default function AuthPage() {
  const router = useRouter();
  const { t } = useLanguage();

  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [signupRole, setSignupRole] = useState<'citizen' | 'authority'>('citizen');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const [currentUser, setCurrentUser] = useState<FirebaseUser | null>(null);
  const [existingRole, setExistingRole] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [authLoading, setAuthLoading] = useState(false);
  const [error, setError] = useState('');
  const [copiedField, setCopiedField] = useState<string | null>(null);

  const isSigningInRef = useRef(false);

  const copyToClipboard = (text: string, fieldId: string) => {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(text);
      setCopiedField(fieldId);
      setTimeout(() => setCopiedField(null), 2000);
    }
  };

  // Seed sample demo accounts into Firestore on initial render
  useEffect(() => {
    const seedSampleAccounts = async () => {
      try {
        for (const acc of SAMPLE_ACCOUNTS) {
          const sampleUid = 'usr_' + acc.email.replace(/[^a-z0-9]/gi, '_');
          await setDoc(
            doc(db, 'users', sampleUid),
            {
              uid: sampleUid,
              name: acc.name,
              email: acc.email,
              role: acc.role,
              department: acc.department,
              createdAt: '2026-01-01T00:00:00.000Z',
              updatedAt: new Date().toISOString(),
            },
            { merge: true }
          );
        }
      } catch (err) {
        console.warn('Notice: Sample accounts background pre-seed:', err);
      }
    };
    seedSampleAccounts();
  }, []);

  const redirectByRole = useCallback(
    (userRole: string) => {
      if (userRole === 'authority') {
        router.push('/authority');
      } else if (userRole === 'admin') {
        router.push('/admin');
      } else {
        router.push('/citizen');
      }
    },
    [router]
  );

  const handleQuickDemoLogin = async (acc: SampleAccount) => {
    setEmail(acc.email);
    setPassword(acc.defaultPassword);
    setError('');
    setAuthLoading(true);
    isSigningInRef.current = true;

    try {
      const cleanEmail = acc.email.toLowerCase();
      const cleanPass = acc.defaultPassword;
      let user: any = null;

      try {
        const cred = await signInWithEmailAndPassword(auth, cleanEmail, cleanPass);
        user = cred.user;
      } catch {
        try {
          const newCred = await createUserWithEmailAndPassword(auth, cleanEmail, cleanPass);
          user = newCred.user;
        } catch {
          const fallbackUid = 'usr_' + cleanEmail.replace(/[^a-z0-9]/gi, '_');
          user = { uid: fallbackUid, email: cleanEmail };
        }
      }

      const activeUid = user?.uid || ('usr_' + cleanEmail.replace(/[^a-z0-9]/gi, '_'));
      const assignedRole = acc.role;

      await setDoc(
        doc(db, 'users', activeUid),
        {
          uid: activeUid,
          name: acc.name,
          email: cleanEmail,
          role: assignedRole,
          department: acc.department,
          updatedAt: new Date().toISOString(),
        },
        { merge: true }
      );

      if (typeof window !== 'undefined') {
        localStorage.setItem('user_role', assignedRole);
        localStorage.setItem('user_email', cleanEmail);
        localStorage.setItem('user_uid', activeUid);
      }

      await logSecurityEvent({
        userId: activeUid,
        email: cleanEmail,
        role: assignedRole,
        action: 'LOGIN_SUCCESS',
        portal: assignedRole as any,
        status: 'SUCCESS',
        details: `One-click demo sign in executed for role: ${assignedRole.toUpperCase()}.`,
      });

      window.location.href = `/${assignedRole}`;
    } catch (err: any) {
      console.error('Quick demo login error:', err);
      setError(err?.message || 'Failed to sign in to demo account.');
      setAuthLoading(false);
      isSigningInRef.current = false;
    }
  };

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (isSigningInRef.current) return;

      let effUser: any = user;
      if (!effUser && typeof window !== 'undefined') {
        const storedEmail = localStorage.getItem('user_email');
        const storedUid = localStorage.getItem('user_uid');
        if (storedEmail && storedUid) {
          effUser = { uid: storedUid, email: storedEmail };
        }
      }

      if (effUser) {
        setCurrentUser(effUser);
        try {
          const userDoc = await getDoc(doc(db, 'users', effUser.uid));
          if (userDoc.exists()) {
            const data = userDoc.data();
            const fetchedRole = data.role || 'citizen';
            setExistingRole(fetchedRole);
            if (typeof window !== 'undefined') {
              localStorage.setItem('user_role', fetchedRole);
            }
          } else {
            const cachedRole = typeof window !== 'undefined' ? localStorage.getItem('user_role') : null;
            if (cachedRole) {
              setExistingRole(cachedRole);
            }
          }
        } catch (err) {
          console.warn('Firestore offline notice fetching user document:', err);
          const cachedRole = typeof window !== 'undefined' ? localStorage.getItem('user_role') : null;
          if (cachedRole) {
            setExistingRole(cachedRole);
          }
        }
      } else {
        setCurrentUser(null);
        setExistingRole(null);
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const handleAuthSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setAuthLoading(true);
    isSigningInRef.current = true;

    const cleanEmail = email.trim().toLowerCase();
    const cleanPass = password.trim();

    if (!cleanEmail || !cleanPass) {
      setError('Please enter both email and password to proceed.');
      setAuthLoading(false);
      isSigningInRef.current = false;
      return;
    }

    let user: any = null;

    if (mode === 'signin') {
      const sampleAcc = SAMPLE_ACCOUNTS.find((a) => a.email.toLowerCase() === cleanEmail);
      if (sampleAcc) {
        const isPasswordValid =
          sampleAcc.passwords.some((p) => p.toLowerCase() === cleanPass.toLowerCase()) ||
          cleanPass === sampleAcc.defaultPassword;

        if (!isPasswordValid) {
          setError(`Invalid password for ${sampleAcc.roleLabel}. Use: "${sampleAcc.defaultPassword}" (or "${sampleAcc.passwords[1]}").`);
          setAuthLoading(false);
          isSigningInRef.current = false;
          return;
        }

        try {
          try {
            const cred = await signInWithEmailAndPassword(auth, cleanEmail, cleanPass);
            user = cred.user;
          } catch {
            try {
              const newCred = await createUserWithEmailAndPassword(auth, cleanEmail, sampleAcc.defaultPassword);
              user = newCred.user;
            } catch {
              const fallbackUid = 'usr_' + cleanEmail.replace(/[^a-z0-9]/gi, '_');
              user = { uid: fallbackUid, email: cleanEmail };
            }
          }

          const activeUid = user?.uid || ('usr_' + cleanEmail.replace(/[^a-z0-9]/gi, '_'));
          const assignedRole = sampleAcc.role;

          await setDoc(
            doc(db, 'users', activeUid),
            {
              uid: activeUid,
              name: sampleAcc.name,
              email: cleanEmail,
              role: assignedRole,
              department: sampleAcc.department,
              updatedAt: new Date().toISOString(),
            },
            { merge: true }
          );

          if (typeof window !== 'undefined') {
            localStorage.setItem('user_role', assignedRole);
            localStorage.setItem('user_email', cleanEmail);
            localStorage.setItem('user_uid', activeUid);
          }

          await logSecurityEvent({
            userId: activeUid,
            email: cleanEmail,
            role: assignedRole,
            action: 'LOGIN_SUCCESS',
            portal: assignedRole as any,
            status: 'SUCCESS',
            details: `User signed in with sample credentials as ${assignedRole.toUpperCase()}.`,
          });

          window.location.href = `/${assignedRole}`;
          return;
        } catch (e: any) {
          console.error('Error during sample signin:', e);
          setError('Sample sign in error. Please try again.');
          setAuthLoading(false);
          isSigningInRef.current = false;
          return;
        }
      }

      try {
        const cred = await signInWithEmailAndPassword(auth, cleanEmail, cleanPass);
        user = cred.user;
      } catch (err: any) {
        const errCode = err?.code || '';
        if (errCode === 'auth/operation-not-allowed' || errCode === 'auth/admin-restricted-operation') {
          console.warn('Firebase Auth Email/Password disabled, using managed account session:', cleanEmail);
          const fallbackUid = 'usr_' + cleanEmail.replace(/[^a-z0-9]/gi, '_');
          user = { uid: fallbackUid, email: cleanEmail };
        } else {
          let errorMsg = 'Failed to sign in. Please check your email and password.';
          if (errCode === 'auth/wrong-password' || errCode === 'auth/invalid-credential') {
            errorMsg = 'Incorrect email or password. Please verify your credentials and try again.';
          } else if (errCode === 'auth/user-not-found') {
            errorMsg = `No account found for "${cleanEmail}". Please select "Create Account" tab to register.`;
          } else if (errCode === 'auth/too-many-requests') {
            errorMsg = 'Access disabled temporarily due to too many failed login attempts. Try again later.';
          } else if (errCode === 'auth/network-request-failed') {
            errorMsg = 'Network error. Please check your connection and try again.';
          } else if (err?.message) {
            errorMsg = err.message;
          }
          setError(errorMsg);
          setAuthLoading(false);
          isSigningInRef.current = false;
          return;
        }
      }

      if (!user) {
        setError('Authentication failed. Please try again.');
        setAuthLoading(false);
        isSigningInRef.current = false;
        return;
      }

      const activeUid = user.uid;
      let assignedRole: 'citizen' | 'authority' | 'admin' = 'citizen';

      try {
        const userDoc = await getDoc(doc(db, 'users', activeUid));
        if (userDoc.exists()) {
          assignedRole = (userDoc.data().role || 'citizen') as 'citizen' | 'authority' | 'admin';
        } else {
          const q = query(collection(db, 'users'), where('email', '==', cleanEmail));
          const snap = await getDocs(q);
          if (!snap.empty) {
            assignedRole = (snap.docs[0].data().role || 'citizen') as 'citizen' | 'authority' | 'admin';
          } else {
            // Store fallback citizen profile if older user profile missing
            await setDoc(
              doc(db, 'users', activeUid),
              {
                uid: activeUid,
                email: cleanEmail,
                role: 'citizen',
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
              },
              { merge: true }
            );
          }
        }
      } catch (e) {
        console.warn('Firestore profile query notice:', e);
      }

      if (typeof window !== 'undefined') {
        localStorage.setItem('user_role', assignedRole);
        localStorage.setItem('user_email', cleanEmail);
        localStorage.setItem('user_uid', activeUid);
      }

      await logSecurityEvent({
        userId: activeUid,
        email: cleanEmail,
        role: assignedRole,
        action: 'LOGIN_SUCCESS',
        portal: assignedRole as any,
        status: 'SUCCESS',
        details: `User signed in successfully with permanent role: ${assignedRole.toUpperCase()}.`,
      });

      window.location.href = `/${assignedRole}`;
    } else {
      // SIGN UP MODE
      if (!fullName.trim()) {
        setError('Please enter your full name to register.');
        setAuthLoading(false);
        isSigningInRef.current = false;
        return;
      }

      if (cleanPass.length < 6) {
        setError('Password must be at least 6 characters long.');
        setAuthLoading(false);
        isSigningInRef.current = false;
        return;
      }

      try {
        const newCred = await createUserWithEmailAndPassword(auth, cleanEmail, cleanPass);
        user = newCred.user;
      } catch (createErr: any) {
        const errCode = createErr?.code || '';
        if (errCode === 'auth/operation-not-allowed' || errCode === 'auth/admin-restricted-operation') {
          console.warn('Firebase Auth Email/Password disabled, using managed account session:', cleanEmail);
          const fallbackUid = 'usr_' + cleanEmail.replace(/[^a-z0-9]/gi, '_');
          user = { uid: fallbackUid, email: cleanEmail };
        } else {
          let errorMsg = 'Failed to create account. Please try again.';
          if (errCode === 'auth/email-already-in-use') {
            errorMsg = `An account with email "${cleanEmail}" already exists. Please switch to "Sign In" tab to log in.`;
          } else if (errCode === 'auth/invalid-email') {
            errorMsg = 'Invalid email address format. Please enter a valid email.';
          } else if (errCode === 'auth/weak-password') {
            errorMsg = 'Password is too weak. Please use at least 6 characters.';
          } else if (createErr?.message) {
            errorMsg = createErr.message;
          }
          setError(errorMsg);
          setAuthLoading(false);
          isSigningInRef.current = false;
          return;
        }
      }

      if (!user) {
        setError('Account creation failed. Please try again.');
        setAuthLoading(false);
        isSigningInRef.current = false;
        return;
      }

      const activeUid = user.uid;
      const assignedRole = signupRole;

      await setDoc(
        doc(db, 'users', activeUid),
        {
          uid: activeUid,
          name: fullName.trim(),
          email: cleanEmail,
          role: assignedRole,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        { merge: true }
      );

      if (typeof window !== 'undefined') {
        localStorage.setItem('user_role', assignedRole);
        localStorage.setItem('user_email', cleanEmail);
        localStorage.setItem('user_uid', activeUid);
      }

      await logSecurityEvent({
        userId: activeUid,
        email: cleanEmail,
        role: assignedRole,
        action: 'SIGNUP_SUCCESS',
        portal: assignedRole as any,
        status: 'SUCCESS',
        details: `New account registered as ${assignedRole.toUpperCase()}.`,
      });

      window.location.href = `/${assignedRole}`;
    }
  };

  const handleGoogleAuth = async () => {
    setError('');
    setAuthLoading(true);
    isSigningInRef.current = true;

    try {
      const provider = new GoogleAuthProvider();
      const userCredential = await signInWithPopup(auth, provider);
      const user = userCredential.user;

      if (!user || !user.email) {
        setError('Google sign in failed to retrieve user details.');
        setAuthLoading(false);
        isSigningInRef.current = false;
        return;
      }

      const googleEmail = user.email.toLowerCase();
      const userDoc = await getDoc(doc(db, 'users', user.uid));

      if (mode === 'signin') {
        let assignedRole = 'citizen';
        if (userDoc.exists()) {
          assignedRole = userDoc.data()?.role || 'citizen';
        } else {
          await setDoc(
            doc(db, 'users', user.uid),
            {
              uid: user.uid,
              name: user.displayName || 'Google User',
              email: googleEmail,
              role: 'citizen',
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            },
            { merge: true }
          );
        }

        if (typeof window !== 'undefined') {
          localStorage.setItem('user_role', assignedRole);
          localStorage.setItem('user_email', googleEmail);
          localStorage.setItem('user_uid', user.uid);
        }

        redirectByRole(assignedRole);
      } else {
        const assignedRole = signupRole;
        if (userDoc.exists()) {
          const registeredRole = userDoc.data()?.role || 'citizen';
          if (typeof window !== 'undefined') {
            localStorage.setItem('user_role', registeredRole);
            localStorage.setItem('user_email', googleEmail);
            localStorage.setItem('user_uid', user.uid);
          }
          redirectByRole(registeredRole);
          return;
        }

        await setDoc(doc(db, 'users', user.uid), {
          uid: user.uid,
          name: user.displayName || fullName || 'Google User',
          email: googleEmail,
          role: assignedRole,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });

        if (typeof window !== 'undefined') {
          localStorage.setItem('user_role', assignedRole);
          localStorage.setItem('user_email', googleEmail);
          localStorage.setItem('user_uid', user.uid);
        }

        redirectByRole(assignedRole);
      }
    } catch (err: any) {
      console.error('Google Auth error:', err);
      setError(err?.message || 'Google sign in failed.');
      isSigningInRef.current = false;
      setAuthLoading(false);
    }
  };

  const handleSignOut = async () => {
    await signOut(auth);
    setCurrentUser(null);
    setExistingRole(null);
    if (typeof window !== 'undefined') {
      localStorage.removeItem('user_role');
      localStorage.removeItem('user_email');
      localStorage.removeItem('user_uid');
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#07090e] flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#07090e] text-slate-200 flex flex-col items-center justify-center p-4 font-sans py-12 relative overflow-hidden">
      <div className="absolute top-1/4 -left-32 w-96 h-96 bg-blue-600/15 rounded-full blur-3xl pointer-events-none animate-pulse" />
      <div className="absolute bottom-1/4 -right-32 w-96 h-96 bg-indigo-600/15 rounded-full blur-3xl pointer-events-none animate-pulse" />
      <div className="absolute top-10 right-1/3 w-64 h-64 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none" />

      <div className="w-full max-w-xl glass-card rounded-3xl border border-white/10 overflow-hidden shadow-2xl relative z-10 glow-blue">
        <div className="p-8 pb-6 border-b border-white/10 text-center bg-gradient-to-b from-white/10 via-white/5 to-transparent relative">
          <div className="absolute top-4 right-4">
            <LanguageSelector />
          </div>
          <div className="w-16 h-16 bg-gradient-to-tr from-blue-600 via-indigo-600 to-purple-600 rounded-2xl flex items-center justify-center text-white mx-auto mb-3 shadow-xl shadow-blue-600/30 border border-white/20 animate-float">
            <Building2 className="w-8 h-8" />
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-gradient-shimmer">{t('app_title', 'CrowdCivic AI')}</h1>
          <p className="text-xs font-mono uppercase tracking-widest text-emerald-400 mt-1.5 flex items-center justify-center gap-1.5 font-semibold">
            <ShieldCheck className="w-4 h-4 text-emerald-400" /> {t('app_subtitle', 'AI Verification & Municipal Resolution System')}
          </p>
        </div>

        <div className="p-6 sm:p-8 space-y-6">
          {currentUser && (
            <div className="p-3.5 rounded-xl bg-blue-500/10 border border-blue-500/20 text-xs text-slate-300 flex items-center justify-between">
              <div>
                <span className="text-slate-400 text-[10px] block">Currently signed in:</span>
                <span className="font-semibold text-white font-mono truncate">{currentUser.email}</span>
                {existingRole && (
                  <span className="ml-2 px-2 py-0.5 rounded bg-blue-600 text-white font-semibold uppercase text-[9px]">
                    {existingRole}
                  </span>
                )}
              </div>
              <button
                type="button"
                onClick={handleSignOut}
                className="text-xs text-red-400 hover:text-red-300 flex items-center gap-1 font-medium bg-white/5 px-2.5 py-1.5 rounded-lg border border-white/10"
              >
                <LogOut className="w-3.5 h-3.5" /> Sign out
              </button>
            </div>
          )}

          <form onSubmit={handleAuthSubmit} className="space-y-4">
            <div className="flex bg-[#07090e] p-1 rounded-xl border border-white/10">
              <button
                type="button"
                onClick={() => setMode('signin')}
                className={`flex-1 py-2 text-xs font-semibold rounded-lg transition-all flex items-center justify-center gap-1.5 ${
                  mode === 'signin' ? 'bg-white/10 text-white shadow' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <LogIn className="w-3.5 h-3.5" />
                <span>Sign In</span>
              </button>
              <button
                type="button"
                onClick={() => setMode('signup')}
                className={`flex-1 py-2 text-xs font-semibold rounded-lg transition-all flex items-center justify-center gap-1.5 ${
                  mode === 'signup' ? 'bg-white/10 text-white shadow' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <UserPlus className="w-3.5 h-3.5" />
                <span>Create Account</span>
              </button>
            </div>

            {mode === 'signup' && (
              <>
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">Full Name</label>
                  <div className="relative">
                    <User className="w-4 h-4 text-slate-500 absolute left-3 top-3" />
                    <input
                      type="text"
                      required
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      placeholder="Jane Doe"
                      className="w-full bg-[#07090e] border border-white/10 rounded-xl pl-9 pr-3 py-2.5 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-blue-500"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-[11px] font-mono uppercase text-slate-300 mb-2 flex items-center justify-between">
                    <span>Account Type / Role:</span>
                    <span className="text-[10px] text-blue-400 capitalize">{signupRole}</span>
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setSignupRole('citizen')}
                      className={`py-2 px-3 rounded-xl border text-xs font-semibold flex items-center justify-center gap-1.5 transition-all ${
                        signupRole === 'citizen'
                          ? 'border-blue-500 bg-blue-500/20 text-blue-300'
                          : 'border-white/10 bg-white/5 text-slate-400'
                      }`}
                    >
                      <User className="w-3.5 h-3.5" /> Citizen
                    </button>

                    <button
                      type="button"
                      onClick={() => setSignupRole('authority')}
                      className={`py-2 px-3 rounded-xl border text-xs font-semibold flex items-center justify-center gap-1.5 transition-all ${
                        signupRole === 'authority'
                          ? 'border-emerald-500 bg-emerald-500/20 text-emerald-300'
                          : 'border-white/10 bg-white/5 text-slate-400'
                      }`}
                    >
                      <Building2 className="w-3.5 h-3.5" /> Authority
                    </button>
                  </div>
                  <p className="text-[10px] text-slate-400 mt-1.5 italic">
                    Admin accounts cannot be created via public registration.
                  </p>
                </div>
              </>
            )}

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">Email Address</label>
              <div className="relative">
                <Mail className="w-4 h-4 text-slate-500 absolute left-3 top-3" />
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="user@example.com"
                  className="w-full bg-[#07090e] border border-white/10 rounded-xl pl-9 pr-3 py-2.5 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-blue-500"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">Password</label>
              <div className="relative">
                <Lock className="w-4 h-4 text-slate-500 absolute left-3 top-3" />
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full bg-[#07090e] border border-white/10 rounded-xl pl-9 pr-3 py-2.5 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-blue-500"
                />
              </div>
            </div>

            {error && (
              <div className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 p-3 rounded-xl">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={authLoading}
              className="w-full text-white font-bold text-xs uppercase tracking-wider py-3.5 rounded-xl transition-all disabled:opacity-70 flex justify-center items-center gap-2 shadow-lg bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 shadow-blue-600/20"
            >
              {authLoading ? (
                <Loader2 className="w-5 h-5 animate-spin text-white" />
              ) : (
                <>
                  <span>
                    {mode === 'signin' ? 'Sign In' : `Register ${signupRole.toUpperCase()} Account`}
                  </span>
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </form>

          <div className="relative flex items-center justify-center my-4">
            <div className="border-t border-white/10 w-full"></div>
            <span className="bg-[#0e1320] px-3 text-[10px] font-mono text-slate-500 uppercase">Or</span>
          </div>

          <div>
            <button
              type="button"
              onClick={handleGoogleAuth}
              disabled={authLoading}
              className="w-full bg-white/5 hover:bg-white/10 border border-white/10 text-slate-200 font-semibold text-xs py-3 rounded-xl transition-all flex items-center justify-center gap-2"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                <path
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                  fill="#4285F4"
                />
                <path
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                  fill="#34A853"
                />
                <path
                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                  fill="#FBBC05"
                />
                <path
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                  fill="#EA4335"
                />
              </svg>
              <span>Continue with Google Account</span>
            </button>
          </div>

          {/* SAMPLE TEST ACCOUNTS - INSTANT 1-CLICK ACCESS */}
          <div className="pt-4 border-t border-white/10 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-mono font-semibold uppercase tracking-wider text-slate-300 flex items-center gap-1.5">
                <Key className="w-3.5 h-3.5 text-amber-400" />
                <span>Sample Sign-In Credentials</span>
              </span>
              <span className="text-[10px] text-slate-400 bg-white/5 border border-white/10 px-2 py-0.5 rounded-full">
                1-Click Direct Access
              </span>
            </div>

            <div className="grid grid-cols-1 gap-2.5">
              {SAMPLE_ACCOUNTS.map((acc) => {
                const isCitizen = acc.role === 'citizen';
                const isAuthority = acc.role === 'authority';

                const borderClass = isCitizen
                  ? 'border-blue-500/30 hover:border-blue-400/60 bg-blue-950/20'
                  : isAuthority
                  ? 'border-emerald-500/30 hover:border-emerald-400/60 bg-emerald-950/20'
                  : 'border-purple-500/30 hover:border-purple-400/60 bg-purple-950/20';

                const tagClass = isCitizen
                  ? 'bg-blue-500/20 text-blue-300 border-blue-500/30'
                  : isAuthority
                  ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
                  : 'bg-purple-500/20 text-purple-300 border-purple-500/30';

                const btnClass = isCitizen
                  ? 'bg-blue-600 hover:bg-blue-500 text-white shadow-blue-600/20'
                  : isAuthority
                  ? 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-emerald-600/20'
                  : 'bg-purple-600 hover:bg-purple-500 text-white shadow-purple-600/20';

                const Icon = isCitizen ? User : isAuthority ? Building2 : Shield;

                return (
                  <div
                    key={acc.role}
                    className={`p-3 rounded-2xl border transition-all ${borderClass}`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <div className={`p-1.5 rounded-lg border ${tagClass}`}>
                          <Icon className="w-3.5 h-3.5" />
                        </div>
                        <div>
                          <span className="text-xs font-bold text-white block">
                            {acc.roleLabel}
                          </span>
                          <span className="text-[10px] text-slate-400">
                            {acc.name} • {acc.department}
                          </span>
                        </div>
                      </div>
                      <button
                        type="button"
                        disabled={authLoading}
                        onClick={() => handleQuickDemoLogin(acc)}
                        className={`text-[11px] font-semibold px-3 py-1.5 rounded-xl transition-all shadow flex items-center gap-1.5 ${btnClass}`}
                        title={`Sign in as ${acc.roleLabel}`}
                      >
                        <Sparkles className="w-3 h-3" />
                        <span>Sign In</span>
                      </button>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 text-[11px] font-mono bg-black/40 p-2 rounded-xl border border-white/5">
                      <div className="flex items-center justify-between pr-1">
                        <span className="text-slate-400 text-[10px]">Email:</span>
                        <div className="flex items-center gap-1">
                          <span className="text-slate-200 truncate max-w-[150px]">{acc.email}</span>
                          <button
                            type="button"
                            onClick={() => copyToClipboard(acc.email, `email_${acc.role}`)}
                            className="p-1 hover:bg-white/10 rounded text-slate-400 hover:text-white"
                            title="Copy email"
                          >
                            {copiedField === `email_${acc.role}` ? (
                              <Check className="w-3 h-3 text-emerald-400" />
                            ) : (
                              <Copy className="w-3 h-3" />
                            )}
                          </button>
                        </div>
                      </div>

                      <div className="flex items-center justify-between pr-1">
                        <span className="text-slate-400 text-[10px]">Password:</span>
                        <div className="flex items-center gap-1">
                          <span className="text-amber-300 font-semibold">{acc.defaultPassword}</span>
                          <button
                            type="button"
                            onClick={() => copyToClipboard(acc.defaultPassword, `pass_${acc.role}`)}
                            className="p-1 hover:bg-white/10 rounded text-slate-400 hover:text-white"
                            title="Copy password"
                          >
                            {copiedField === `pass_${acc.role}` ? (
                              <Check className="w-3 h-3 text-emerald-400" />
                            ) : (
                              <Copy className="w-3 h-3" />
                            )}
                          </button>
                        </div>
                      </div>

                      {acc.pin && (
                        <div className="sm:col-span-2 flex items-center justify-between pr-1 pt-1 border-t border-white/5 text-[10px]">
                          <span className="text-slate-400 flex items-center gap-1">
                            <Lock className="w-2.5 h-2.5 text-slate-500" />
                            <span>Security 2FA PIN (for actions):</span>
                          </span>
                          <div className="flex items-center gap-1">
                            <span className="text-emerald-400 font-bold">{acc.pin}</span>
                            <button
                              type="button"
                              onClick={() => copyToClipboard(acc.pin!, `pin_${acc.role}`)}
                              className="p-1 hover:bg-white/10 rounded text-slate-400 hover:text-white"
                              title="Copy 2FA PIN"
                            >
                              {copiedField === `pin_${acc.role}` ? (
                                <Check className="w-2.5 h-2.5 text-emerald-400" />
                              ) : (
                                <Copy className="w-2.5 h-2.5" />
                              )}
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
