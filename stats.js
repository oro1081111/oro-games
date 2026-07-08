(function () {
  const key = "oro-games.local-play-counts.v1";

  function read() {
    try {
      return JSON.parse(localStorage.getItem(key)) || {};
    } catch (_) {
      return {};
    }
  }

  function write(data) {
    localStorage.setItem(key, JSON.stringify(data));
  }

  window.OroStats = {
    increment(gameId) {
      const data = read();
      data[gameId] = (Number(data[gameId]) || 0) + 1;
      write(data);
      return data[gameId];
    },
    get(gameId) {
      return Number(read()[gameId]) || 0;
    },
    total() {
      return Object.values(read()).reduce((sum, value) => sum + (Number(value) || 0), 0);
    }
  };
})();
