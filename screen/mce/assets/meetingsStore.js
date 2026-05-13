/* This software is in the public domain under CC0 1.0 Universal plus a Grant of Patent License. */

/**
 * meetingsStore.js
 * 
 * Pinia state management for Active Meetings across the Moqui-AI SPA.
 * Manages the array of AgendaContainers that the user has marked as "active".
 */
import { defineStore } from 'https://unpkg.com/pinia@2.1.7/dist/pinia.esm-browser.js';


export const useMeetingsStore = defineStore('meetingsStore', {
    state: () => ({
        activeList: [],
        openSessionIds: [],
        activeInstancesList: [],
        activeAgendaContainerId: null,
        historyAgendaContainerId: null,
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
