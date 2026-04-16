import React, { useState, useEffect, useRef, useCallback } from "react";
import { Mic, MicOff, Loader2, Volume2, VolumeX, Keyboard, Send, Trash2, Copy, Check, Cpu, HardDrive, Activity, Terminal, Camera, Scan, Eye } from "lucide-react";
import { getZoyaResponse, getZoyaAudio, resetZoyaSession } from "./services/geminiService";
import { processCommand } from "./services/commandService";
import { LiveSessionManager } from "./services/liveService";
import Visualizer from "./components/Visualizer";
import PermissionModal from "./components/PermissionModal";
import { playPCM } from "./utils/audioUtils";
import { copyToClipboard } from "./utils/systemUtils";
import { motion, AnimatePresence } from "motion/react";

type AppState = "idle" | "listening" | "processing" | "speaking";

interface ChatMessage {
  id: string;
  sender: "user" | "zoya";
  text: string;
}

declare global {
  interface Window {
    SpeechRecognition: any;
    webkitSpeechRecognition: any;
  }
}

export default function App() {
  const [appState, setAppState] = useState<AppState>("idle");
  const [messages, setMessages] = useState<ChatMessage[]>(() => {
    const saved = localStorage.getItem("zoya_chat_history");
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {
        console.error("Failed to parse chat history", e);
      }
    }
    return [];
  });
  const messagesRef = useRef(messages);

  useEffect(() => {
    messagesRef.current = messages;
    localStorage.setItem("zoya_chat_history", JSON.stringify(messages));
  }, [messages]);

  const [isMuted, setIsMuted] = useState(false);
  const [volume, setVolume] = useState(0.8);
  const [isCapturing, setIsCapturing] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [showChat, setShowChat] = useState(false);
  const [showTerminal, setShowTerminal] = useState(false);
  const [terminalLogs, setTerminalLogs] = useState<string[]>(["[SYSTEM] Zoya Automation Engine v2.0 initialized...", "[AUTH] User: Ritik authenticated."]);

  const addTerminalLog = (log: string) => {
    setTerminalLogs(prev => [...prev.slice(-10), `[${new Date().toLocaleTimeString()}] ${log}`]);
  };

  const handleCopy = async (text: string, id: string) => {
    const success = await copyToClipboard(text);
    if (success) {
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    }
  };

  useEffect(() => {
    if (liveSessionRef.current) {
      liveSessionRef.current.isMuted = isMuted;
      liveSessionRef.current.volume = volume;
    }
  }, [isMuted, volume]);

  const [showTextInput, setShowTextInput] = useState(false);
  const [textInput, setTextInput] = useState("");
  const [showPermissionModal, setShowPermissionModal] = useState(false);
  const [isSessionActive, setIsSessionActive] = useState(false);

  const liveSessionRef = useRef<LiveSessionManager | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, appState]);

  const handleTextCommand = useCallback(async (finalTranscript: string) => {
    if (!finalTranscript.trim()) {
      setAppState("idle");
      return;
    }

    setMessages((prev) => [...prev, { id: Date.now().toString(), sender: "user", text: finalTranscript }]);
    
    // If live session is active, send text through it
    if (isSessionActive && liveSessionRef.current) {
      liveSessionRef.current.sendText(finalTranscript);
      return;
    }

    setAppState("processing");

    // 1. Check for browser commands
    const commandResult = processCommand(finalTranscript);

    let responseText = "";

    if (commandResult.isBrowserAction) {
      for (const action of commandResult.actions) {
        addTerminalLog(`EXECUTING: ${action.action}`);
        setMessages((prev) => [...prev, { id: Date.now().toString() + "-z-" + Math.random(), sender: "zoya", text: action.action }]);
        
        if (!isMuted) {
          setAppState("speaking");
          const audioBase64 = await getZoyaAudio(action.action);
          if (audioBase64) {
            await playPCM(audioBase64, volume);
          }
        }

        if (action.url) {
          window.open(action.url, "_blank");
        }
      }
      setAppState("idle");
    } else {
      // 2. General Chit-Chat via Gemini
      responseText = await getZoyaResponse(finalTranscript, messagesRef.current);
      setMessages((prev) => [...prev, { id: Date.now().toString() + "-z", sender: "zoya", text: responseText }]);
      
      if (!isMuted) {
        setAppState("speaking");
        const audioBase64 = await getZoyaAudio(responseText);
        if (audioBase64) {
          await playPCM(audioBase64, volume);
        }
      }
      setAppState("idle");
    }
  }, [isMuted, isSessionActive]);

  useEffect(() => {
    return () => {
      if (liveSessionRef.current) {
        liveSessionRef.current.stop();
      }
    };
  }, []);

  const toggleListening = async () => {
    if (isSessionActive) {
      setIsSessionActive(false);
      if (liveSessionRef.current) {
        liveSessionRef.current.stop();
        liveSessionRef.current = null;
      }
      setAppState("idle");
      resetZoyaSession();
    } else {
      try {
        setIsSessionActive(true);
        resetZoyaSession();
        
        const session = new LiveSessionManager();
        session.isMuted = isMuted;
        session.volume = volume;
        liveSessionRef.current = session;
        
        session.onStateChange = (state) => {
          setAppState(state);
        };
        
        session.onMessage = (sender, text) => {
          setMessages((prev) => [...prev, { id: Date.now().toString() + "-" + sender, sender, text }]);
        };
        
        session.onCommand = (url) => {
          setTimeout(() => {
            window.open(url, "_blank");
          }, 1000);
        };

        await session.start();
      } catch (e) {
        console.error("Failed to start session", e);
        setShowPermissionModal(true);
        setIsSessionActive(false);
        setAppState("idle");
      }
    }
  };

  const handleTextSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!textInput.trim()) return;
    
    handleTextCommand(textInput);
    setTextInput("");
    setShowTextInput(false);
  };

  const handleScreenshot = async () => {
    try {
      setIsCapturing(true);
      addTerminalLog("INITIATING SCREEN CAPTURE...");
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
      const video = document.createElement('video');
      video.srcObject = stream;
      await video.play();
      
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');
      ctx?.drawImage(video, 0, 0);
      
      const base64Image = canvas.toDataURL('image/jpeg').split(',')[1];
      
      // Stop all tracks
      stream.getTracks().forEach(track => track.stop());
      
      setAppState("processing");
      addTerminalLog("ANALYZING SCREENSHOT (OCR/VISION)...");
      
      // Send to Gemini with vision
      const response = await getZoyaResponse("Analyze this screenshot and tell me what you see. If there is code, help me debug it. If there is text, read it.", messagesRef.current, base64Image);
      
      setMessages((prev) => [...prev, { id: Date.now().toString() + "-z", sender: "zoya", text: response }]);
      
      if (!isMuted) {
        setAppState("speaking");
        const audioBase64 = await getZoyaAudio(response);
        if (audioBase64) {
          await playPCM(audioBase64, volume);
        }
      }
      
      setAppState("idle");
      setIsCapturing(false);
      addTerminalLog("ANALYSIS COMPLETE.");
    } catch (e) {
      console.error("Screenshot failed", e);
      setIsCapturing(false);
      setAppState("idle");
      addTerminalLog("SCREEN CAPTURE FAILED.");
    }
  };

  const handleCameraCapture = async () => {
    try {
      setIsCapturing(true);
      addTerminalLog("INITIATING CAMERA CAPTURE...");
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      const video = document.createElement('video');
      video.srcObject = stream;
      await video.play();
      
      // Wait a bit for camera to focus
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');
      ctx?.drawImage(video, 0, 0);
      
      const base64Image = canvas.toDataURL('image/jpeg').split(',')[1];
      
      // Stop all tracks
      stream.getTracks().forEach(track => track.stop());
      
      setAppState("processing");
      addTerminalLog("ANALYZING CAMERA FEED (OCR/VISION)...");
      
      const response = await getZoyaResponse("Analyze this image from my camera. Read any text you see (OCR), describe the objects, and if there's code, help me debug it.", messagesRef.current, base64Image);
      
      setMessages((prev) => [...prev, { id: Date.now().toString() + "-z", sender: "zoya", text: response }]);
      
      if (!isMuted) {
        setAppState("speaking");
        const audioBase64 = await getZoyaAudio(response);
        if (audioBase64) {
          await playPCM(audioBase64, volume);
        }
      }
      
      setAppState("idle");
      setIsCapturing(false);
      addTerminalLog("CAMERA ANALYSIS COMPLETE.");
    } catch (e) {
      console.error("Camera capture failed", e);
      setIsCapturing(false);
      setAppState("idle");
      addTerminalLog("CAMERA CAPTURE FAILED.");
    }
  };

  return (
    <div className="h-[100dvh] w-screen bg-[#050505] text-white flex flex-col items-center justify-between font-sans relative overflow-hidden m-0 p-0">
      {showPermissionModal && (
        <PermissionModal 
          onClose={() => setShowPermissionModal(false)} 
        />
      )}

      {/* Cinematic Background Gradients */}
      <div className="absolute inset-0 w-full h-full overflow-hidden pointer-events-none">
        <div className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] bg-violet-900/20 blur-[120px] rounded-full" />
        <div className="absolute bottom-[-20%] right-[-10%] w-[50%] h-[50%] bg-pink-900/20 blur-[120px] rounded-full" />
      </div>

      {/* Header */}
      <header className="absolute top-0 left-0 w-full flex justify-between items-center z-20 shrink-0 px-6 py-4 md:px-12 md:py-6">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-violet-500 to-pink-500 flex items-center justify-center font-bold text-sm">
            Z
          </div>
          <h1 className="text-xl font-serif font-medium tracking-wide opacity-90">Zoya</h1>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2 bg-white/5 border border-white/10 rounded-full px-3 py-1.5 mr-2">
            <Volume2 size={14} className="text-white/40" />
            <input 
              type="range" 
              min="0" 
              max="1" 
              step="0.1" 
              value={volume} 
              onChange={(e) => setVolume(parseFloat(e.target.value))}
              className="w-16 h-1 bg-white/10 rounded-lg appearance-none cursor-pointer accent-violet-500"
            />
          </div>
          <button
            onClick={() => setShowChat(!showChat)}
            className={`p-2 rounded-full transition-colors border border-white/10 ${showChat ? 'bg-violet-500/20 text-violet-400' : 'bg-white/5 hover:bg-white/10'}`}
            title="Toggle Chat History"
          >
            <Activity size={18} className="opacity-70" />
          </button>
          <button
            onClick={() => setShowTerminal(!showTerminal)}
            className={`p-2 rounded-full transition-colors border border-white/10 ${showTerminal ? 'bg-cyan-500/20 text-cyan-400' : 'bg-white/5 hover:bg-white/10'}`}
            title="Toggle Automation Terminal"
          >
            <Terminal size={18} className="opacity-70" />
          </button>
          {messages.length > 0 && (
            <button
              onClick={() => {
                if (confirm("Are you sure you want to clear the chat history?")) {
                  setMessages([]);
                  resetZoyaSession();
                }
              }}
              className="p-2 rounded-full bg-white/5 hover:bg-red-500/20 hover:text-red-400 transition-colors border border-white/10"
              title="Clear Chat History"
            >
              <Trash2 size={18} className="opacity-70" />
            </button>
          )}
          <button
            onClick={() => setIsMuted(!isMuted)}
            className="p-2 rounded-full bg-white/5 hover:bg-white/10 transition-colors border border-white/10"
            title={isMuted ? "Unmute" : "Mute"}
          >
            {isMuted ? (
              <VolumeX size={18} className="opacity-70" />
            ) : (
              <Volume2 size={18} className="opacity-70" />
            )}
          </button>
        </div>
      </header>

      {/* Main Content - Visualizer & Chat */}
      <main className="absolute inset-0 flex flex-row items-center justify-between w-full h-full z-10 overflow-hidden pt-20 pb-24 px-4 md:px-12 pointer-events-none">
        
        {/* Left Column: Zoya Status & System Stats */}
        <div className="flex w-[30%] lg:w-[25%] h-full flex-col justify-center gap-6 z-10">
          <div className="h-6">
            <AnimatePresence>
              {appState === "processing" && (
                <motion.div
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  className="flex items-center gap-2 text-cyan-300/80 text-sm md:text-base italic font-serif"
                >
                  <Loader2 size={16} className="animate-spin" />
                  Replying...
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Simulated System Stats */}
          <div className="flex flex-col gap-3 pointer-events-auto">
            <div className="bg-white/5 border border-white/10 rounded-xl p-3 backdrop-blur-sm">
              <div className="flex items-center gap-2 text-xs text-white/40 mb-2 uppercase tracking-widest font-bold">
                <Cpu size={12} /> CPU Usage
              </div>
              <div className="w-full bg-white/10 h-1 rounded-full overflow-hidden">
                <motion.div 
                  className="bg-cyan-500 h-full"
                  animate={{ width: ["20%", "45%", "30%", "60%", "25%"] }}
                  transition={{ duration: 10, repeat: Infinity, ease: "easeInOut" }}
                />
              </div>
            </div>
            <div className="bg-white/5 border border-white/10 rounded-xl p-3 backdrop-blur-sm">
              <div className="flex items-center gap-2 text-xs text-white/40 mb-2 uppercase tracking-widest font-bold">
                <HardDrive size={12} /> Memory
              </div>
              <div className="w-full bg-white/10 h-1 rounded-full overflow-hidden">
                <motion.div 
                  className="bg-violet-500 h-full"
                  animate={{ width: ["60%", "65%", "62%", "68%", "61%"] }}
                  transition={{ duration: 8, repeat: Infinity, ease: "easeInOut" }}
                />
              </div>
            </div>
          </div>

          {/* Automation Terminal Overlay */}
          <AnimatePresence>
            {showTerminal && (
              <motion.div
                initial={{ opacity: 0, y: 20, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 20, scale: 0.95 }}
                className="bg-black/80 border border-cyan-500/30 rounded-xl p-4 backdrop-blur-md shadow-2xl font-mono text-[10px] text-cyan-400/80 pointer-events-auto h-48 flex flex-col"
              >
                <div className="flex items-center gap-2 mb-2 border-b border-cyan-500/20 pb-1">
                  <Terminal size={12} />
                  <span className="uppercase tracking-widest font-bold">Automation Logs</span>
                </div>
                <div className="flex-1 overflow-y-auto space-y-1 scrollbar-hide">
                  {terminalLogs.map((log, i) => (
                    <div key={i} className="flex gap-2">
                      <span className="text-cyan-500/40">{">"}</span>
                      <span>{log}</span>
                    </div>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Center Visualizer (Fixed Full Screen Background) */}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-0">
          <Visualizer state={appState} />
        </div>

        {/* Right Column: User Status & Chat History */}
        <div className="flex w-[35%] lg:w-[30%] h-full flex-col justify-center gap-4 z-10 relative">
          <div className="h-6 flex justify-end">
            <AnimatePresence>
              {appState === "listening" && (
                <motion.div
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 20 }}
                  className="flex items-center gap-2 text-violet-300/80 text-sm md:text-base italic"
                >
                  <div className="w-2 h-2 rounded-full bg-violet-400 animate-pulse" />
                  Listening...
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Chat History Overlay */}
          <AnimatePresence>
            {showChat && (
              <motion.div
                initial={{ opacity: 0, scale: 0.95, x: 20 }}
                animate={{ opacity: 1, scale: 1, x: 0 }}
                exit={{ opacity: 0, scale: 0.95, x: 20 }}
                className="flex-1 bg-white/5 border border-white/10 rounded-2xl backdrop-blur-xl overflow-hidden flex flex-col pointer-events-auto shadow-2xl"
              >
                <div className="p-3 border-b border-white/10 bg-white/5 flex justify-between items-center">
                  <span className="text-xs font-bold uppercase tracking-widest text-white/40">Encrypted Session</span>
                  <div className="flex gap-1">
                    <div className="w-1.5 h-1.5 rounded-full bg-red-500/50" />
                    <div className="w-1.5 h-1.5 rounded-full bg-yellow-500/50" />
                    <div className="w-1.5 h-1.5 rounded-full bg-green-500/50" />
                  </div>
                </div>
                <div className="flex-1 overflow-y-auto p-4 space-y-4 scrollbar-hide">
                  {messages.length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center text-white/20 text-sm italic text-center px-4">
                      No logs found. Start a session to begin data capture.
                    </div>
                  ) : (
                    messages.map((msg) => (
                      <div key={msg.id} className={`flex flex-col ${msg.sender === 'user' ? 'items-end' : 'items-start'}`}>
                        <div className={`max-w-[90%] p-3 rounded-2xl text-sm relative group ${
                          msg.sender === 'user' 
                            ? 'bg-violet-500/20 text-violet-100 rounded-tr-none border border-violet-500/30' 
                            : 'bg-white/5 text-white/90 rounded-tl-none border border-white/10'
                        }`}>
                          {msg.text}
                          {msg.sender === 'zoya' && (
                            <button 
                              onClick={() => handleCopy(msg.text, msg.id)}
                              className="absolute -right-8 top-0 p-1.5 rounded-lg bg-white/5 opacity-0 group-hover:opacity-100 transition-opacity hover:bg-white/10"
                              title="Copy to clipboard"
                            >
                              {copiedId === msg.id ? <Check size={12} className="text-green-400" /> : <Copy size={12} className="text-white/40" />}
                            </button>
                          )}
                        </div>
                        <span className="text-[10px] text-white/20 mt-1 uppercase tracking-tighter">
                          {msg.sender === 'user' ? 'Ritik' : 'Zoya'} • {new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                    ))
                  )}
                  <div ref={messagesEndRef} />
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

      </main>

      {/* Controls */}
      <footer className="absolute bottom-0 left-0 w-full flex flex-col items-center justify-center pb-6 md:pb-8 z-20 shrink-0 gap-4">
        <AnimatePresence>
          {showTextInput && (
            <motion.form 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 20 }}
              onSubmit={handleTextSubmit}
              className="w-full max-w-md flex items-center gap-2 bg-white/5 border border-white/10 rounded-full p-1 pl-4 backdrop-blur-md shadow-2xl"
            >
              <input 
                type="text"
                value={textInput}
                onChange={(e) => setTextInput(e.target.value)}
                placeholder="Type a message to Zoya..."
                className="flex-1 bg-transparent border-none outline-none text-white placeholder:text-white/30 text-sm"
                autoFocus
              />
              <button 
                type="submit"
                disabled={!textInput.trim()}
                className="p-2 rounded-full bg-violet-500 hover:bg-violet-600 disabled:opacity-50 disabled:hover:bg-violet-500 transition-colors"
              >
                <Send size={16} />
              </button>
            </motion.form>
          )}
        </AnimatePresence>

        <div className="flex items-center gap-4">
          <button
            onClick={toggleListening}
            className={`
              group relative flex items-center gap-3 px-8 py-4 rounded-full font-medium tracking-wide transition-all duration-300 shadow-2xl
              ${
                isSessionActive
                  ? "bg-red-500/20 text-red-400 border border-red-500/50 hover:bg-red-500/30"
                  : "bg-white/10 text-white border border-white/20 hover:bg-white/20 hover:scale-105"
              }
            `}
          >
            {isSessionActive ? (
              <>
                <MicOff size={20} />
                <span>End Session</span>
              </>
            ) : (
              <>
                <Mic size={20} className="group-hover:animate-bounce" />
                <span>Start Session</span>
              </>
            )}
          </button>
          
          {!isSessionActive && (
            <div className="flex items-center gap-2">
              <button
                onClick={handleCameraCapture}
                disabled={isCapturing}
                className="p-4 rounded-full bg-white/5 border border-white/10 hover:bg-violet-500/20 hover:text-violet-400 transition-all shadow-2xl group"
                title="Camera & OCR"
              >
                {isCapturing ? <Loader2 size={20} className="animate-spin" /> : <Camera size={20} className="group-hover:scale-110 transition-transform" />}
              </button>
              <button
                onClick={handleScreenshot}
                disabled={isCapturing}
                className="p-4 rounded-full bg-white/5 border border-white/10 hover:bg-cyan-500/20 hover:text-cyan-400 transition-all shadow-2xl group"
                title="Screenshot & OCR"
              >
                {isCapturing ? <Loader2 size={20} className="animate-spin" /> : <Scan size={20} className="group-hover:scale-110 transition-transform" />}
              </button>
              <button
                onClick={() => setShowTextInput(!showTextInput)}
                className="p-4 rounded-full bg-white/5 border border-white/10 hover:bg-white/10 transition-colors shadow-2xl"
                title="Type instead"
              >
                <Keyboard size={20} className="opacity-70" />
              </button>
            </div>
          )}
        </div>
      </footer>
    </div>
  );
}
