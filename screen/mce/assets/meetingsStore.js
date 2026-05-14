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
        handleCommand(cmd) {
            console.info("[MeetingsStore] Handling Command:", cmd.action);

            switch (cmd.action) {
                case 'ADD_MEETING':
                    // RUGGED: Validate the payload before pushing to the list
                    if (cmd.payload) {
                        this.activeList.push({
                            id: cmd.payload.agendaContainerId || Date.now(),
                            title: cmd.payload.description || 'New Meeting',
                            startTime: cmd.payload.startTime || new Date().toISOString(),
                            // Add other Mantle UDM fields here
                        });
                        console.info("[MeetingsStore] Meeting added successfully.");
                    }
                    break;
                case 'RESIDENT_MISSING':
                    console.error("[EMERGENCY] Resident Missing Pulse Received!");
                    // Trigger a Quasar Global Notification
                    if (window.Quasar && window.Quasar.Notify) {
                        window.Quasar.Notify.create({
                            type: 'negative',
                            message: `EMERGENCY: ${cmd.residentName} is missing from ${cmd.room}!`,
                            icon: 'warning',
                            position: 'top',
                            timeout: 0, // Persistent until dismissed
                            actions: [{ label: 'Dismiss', color: 'white' }]
                        });
                    }
                    break;

                default:
                    console.warn("[MeetingsStore] Unknown action received:", cmd.action);
            }
        },
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
