/* Register Signal Tracker without modifying original VISUALZI/METHOD engine sources. */
(() => {
  if(typeof SignalTrackerAdapter==='undefined'||typeof ENGINES==='undefined'||typeof ENG==='undefined'||typeof Home==='undefined') {
    console.error('[VISUALZI] Signal Tracker: engine host unavailable');return;
  }
  if(!ENG[SignalTrackerAdapter.id]){
    ENGINES.push(SignalTrackerAdapter);
    ENG[SignalTrackerAdapter.id]=SignalTrackerAdapter;
    Home.build(); // refresh gallery before the first render tick
  }
  if(location.hash==='#/tracker') route();
})();