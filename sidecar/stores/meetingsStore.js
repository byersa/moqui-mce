/* This software is in the public domain under CC0 1.0 Universal plus a Grant of Patent License. */

/**
 * meetingsStore.js
 * 
 * Pinia state management for Active Meetings across the Moqui-AI SPA.
 * Manages the array of AgendaContainers that the user has marked as "active".
 */

(function () {
    if (typeof Pinia === 'undefined') {
        console.error('Pinia not found. Cannot define meetingsStore.');
        return;
    }

    const { defineStore } = Pinia;

    window.useMeetingsStore = defineStore('meetingsStore', {
        state: () => ({
            activeList: [], // Abstract templates the user is tracking
            openSessionIds: [], // IDs of meeting instances currently open in split-pane
            activeInstancesList: [], // Cache of metadata for real-time meeting instances
            activeAgendaContainerId: null, // Currently selected abstract template for Active view
            historyAgendaContainerId: null, // Currently selected abstract template for History view
            isLoading: false
        }),
        actions: {
            addMeeting(container) {
                // Prevent duplicates based on agendaContainerId
                const exists = this.activeList.find(m => m.agendaContainerId === container.agendaContainerId);
                if (!exists) {
                    this.activeList.push(container);
                }
            },
            removeMeeting(agendaContainerId) {
                this.activeList = this.activeList.filter(m => m.agendaContainerId !== agendaContainerId);
                this.closeSession(agendaContainerId);
            },
            openSession(agendaContainerId) {
                if (!this.openSessionIds.includes(agendaContainerId)) {
                    this.openSessionIds.push(agendaContainerId);
                }
            },
            closeSession(agendaContainerId) {
                this.openSessionIds = this.openSessionIds.filter(id => id !== agendaContainerId);
            },
            isActive(agendaContainerId) {
                return this.activeList.some(m => m.agendaContainerId === agendaContainerId);
            }
        }
    });
})();
