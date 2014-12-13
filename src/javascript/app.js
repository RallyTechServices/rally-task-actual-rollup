Ext.define('CustomApp', {
    extend: 'Rally.app.App',
    componentCls: 'app',
    logger: new Rally.technicalservices.Logger(),
    calculation_fields: { 'TaskActualTotal': 'Estimate' ,'TaskEstimateTotal':'Actual','TaskRemainingTotal':'To Do'},
    items: [
        {xtype:'container',itemId:'message_box',tpl:'Hello, <tpl>{_refObjectName}</tpl>'},
        {xtype:'container',itemId:'display_box', margin: 10},
        {xtype:'tsinfolink'}
    ],
    launch: function() {
        this._getPortfolioItemTypes().then({
            scope: this,
            success:function(types) {
                this.pi_types = types;
                var lowest_type = types[0];
                
                this._loadStories(lowest_type.get('ElementName')).then({
                    scope: this,
                    success: function(stories){
                        this._addParentInformation(stories,lowest_type.get('ElementName')).then({
                            scope: this,
                            success: function(parents) {
                                records = this._consolidateParentInfoInStories(stories,parents);
                                
                                var top_type = types[types.length - 1].get('Name');
                                
                                var store = Ext.create('Rally.data.custom.Store',{
                                    data: records,
                                    sorters: [{property: top_type + "_ObjectID"}]
                                });
//                                
                                var columns = [];
                                for ( var i=this.pi_types.length; i>0; i-- ) {
                                    var sub_columns = [];
                                    var type = this.pi_types[i-1].get('ElementName');
                                    sub_columns.push({dataIndex:type + "_FormattedID",text: " id", width: 50});
                                    
                                    Ext.Object.each(this.calculation_fields,function(calculation_field,calculation_header){
                                        sub_columns.push({dataIndex:type + "_" +calculation_field,text: calculation_header});
                                    });
                                    columns.push({ text: type, columns: sub_columns });
                                }
                                Ext.Array.push(columns, [
                                    { text: "Story", columns: [
                                            {dataIndex:'FormattedID',text:'id', width: 50}, 
                                            {dataIndex:'Name',text:'Name',width: 200},
                                            {dataIndex: 'PlanEstimate', text:'Plan Estimate (Pts)'},
                                            {dataIndex: 'TaskEstimateTotal', text:'Estimate Hours'},
                                            {dataIndex: 'TaskActualTotal', text:'Actual Hours'},
                                            {dataIndex: 'TaskRemainingTotal', text:'To Do'}
                                        ]
                                    }
                                ]);
                                
                                this.down('#display_box').add({
                                    xtype: 'rallygrid',
                                    store: store,
                                    sortableColumns: false,
                                    columnCfgs: columns
                                });
                            },
                            failure: function(error_message) {
                                alert(error_message);
                            }
                        });
                    },
                    failure: function(error_message){
                        alert(error_message);
                    }
                });
            },
            failure: function(msg) {
                alert(msg);
            }
        });
        
        
    },
    _addParentInformation: function(records,parent_field) {
        var deferred = Ext.create('Deft.Deferred');
        
        var parent_oids = [];
        Ext.Array.each(records,function(record){ 
            if ( record.get(parent_field)) {
                var parent_oid = record.get(parent_field).ObjectID;
                if ( parent_oid ) {
                    parent_oids = Ext.Array.merge(parent_oids,[parent_oid]); 
                }
            }
        });
        
        var parent_type = 'PortfolioItem/' + parent_field;
        
        this._loadItemsByObjectID(parent_oids,parent_type,[]).then({
            scope: this,
            success: function(parents){
                var item_hash = {};
                Ext.Array.each(parents, function(parent){
                    item_hash[parent.get('ObjectID')] = parent;
                });
                // calculate rollups for direct parents
                Ext.Array.each(records,function(child) {
                    var parent_link = child.get(parent_field);
                    if ( parent_link ) {
                        var parent = item_hash[parent_link.ObjectID];
                        Ext.Object.each(this.calculation_fields,function(calculation_field,calculation_header){
                            var parent_value = parent.get(calculation_field) || 0;
                            var child_value = child.get(calculation_field) || 0;
                            parent.set(calculation_field,parent_value+child_value);
                        });
                    }
                },this);
                // cycle through parent types to roll up data
                Ext.Array.each(this.pi_types, function(pi_type) {
                    Ext.Object.each(item_hash, function(key,child){
                        if ( Ext.util.Format.lowercase(pi_type.get('TypePath') ) == child.get('_type') ){
                            var parent_link = child.get('Parent');
                            if ( parent_link ) {
                                var parent = item_hash[parent_link.ObjectID];
                                Ext.Object.each(this.calculation_fields,function(calculation_field,calculation_header){
                                    var parent_value = parent.get(calculation_field) || 0;
                                    var child_value = child.get(calculation_field) || 0;
                                    parent.set(calculation_field,parent_value+child_value);
                                });
                            }
                        }
                    },this);
                },this);
                console.log('---',Ext.clone(item_hash));
                deferred.resolve(item_hash);
            },
            failure: function(error_message) {
                deferred.reject(error_message);
            }
        });
        return deferred.promise;
    },
    _getParentTypeFor:function(type) {
        var parent_type = null;
        Ext.Array.each(this.pi_types,function(pi_type,idx) {
            if ( type == pi_type.get('TypePath') ) {
                parent_type = this.pi_types[idx+1].get('TypePath');
            }
        },this);
        return parent_type;
    },
    _loadItemsByObjectID:function(parent_oids,parent_type,children){
        var deferred = Ext.create('Deft.Deferred');
        this.logger.log("_loadItemsByObjectID",parent_type, parent_oids.length);
        
        var filters = Ext.create('Rally.data.wsapi.Filter',{property:'ObjectID',value:parent_oids[0]});

        for ( var i=1; i<parent_oids.length; i++ ) {
            filters = filters.or(Ext.create('Rally.data.wsapi.Filter',{property:'ObjectID',value:parent_oids[i]}));
        }
        
        Ext.create('Rally.data.wsapi.Store', {
            fetch: ['Name','ObjectID','FormattedID','Parent'],
            filters: filters,
            autoLoad: true,
            model: parent_type,
            listeners: {
                scope: this,
                load: function(store, records, successful) {
                    if (successful){
                        var grand_parent_oids = [];
                        Ext.Array.each(records, function(record){
                            if ( record.get('Parent')) {
                                var grand_parent_oid = record.get('Parent').ObjectID;
                                if ( grand_parent_oid ) {
                                    grand_parent_oids = Ext.Array.merge(grand_parent_oids,[grand_parent_oid]); 
                                }
                            }
                        });
                        if ( grand_parent_oids.length > 0 ) {
                            this._loadItemsByObjectID(grand_parent_oids,this._getParentTypeFor(parent_type),Ext.Array.merge(records,children)).then({
                                scope: this,
                                success: function(parents) {
                                    deferred.resolve(parents);
                                },
                                failure: function(msg) {
                                    deferred.reject(msg);
                                }
                            });
                        } else {
                            deferred.resolve(Ext.Array.merge(records,children));
                        }
                    } else {
                        deferred.reject('Failed to load parents');
                    }
                }
            }
        });
        return deferred.promise;
    },
    _getPortfolioItemTypes: function() {
        var deferred = Ext.create('Deft.Deferred');
                
        var store = Ext.create('Rally.data.wsapi.Store', {
            fetch: ['Name','ElementName','TypePath'],
            model: 'TypeDefinition',
            limit: 'Infinity',
            filters: [
                {
                    property: 'Parent.Name',
                    operator: '=',
                    value: 'Portfolio Item'
                },
                {
                    property: 'Creatable',
                    operator: '=',
                    value: 'true'
                }
            ],
            autoLoad: true,
            listeners: {
                load: function(store, records, successful) {
                    if (successful){
                        deferred.resolve(records);
                    } else {
                        deferred.reject('Failed to load initial stories');
                    }
                }
            }
        });
                    
        return deferred.promise;
    },
    _loadStories: function(pi_field){
        var deferred = Ext.create('Deft.Deferred');
        
        var store = Ext.create('Rally.data.wsapi.Store', {
            fetch: ['Name','ObjectID','FormattedID','TaskActualTotal','TaskEstimateTotal','PlanEstimate','TaskRemainingTotal',pi_field],
            model: 'HierarchicalRequirement',
            filters: [{
                property: 'DirectChildrenCount',
                value: 0
            }],
            autoLoad: true,
            listeners: {
                load: function(store, records, successful) {
                    if (successful){
                        deferred.resolve(records);
                    } else {
                        deferred.reject('Failed to load initial Snapshot Store');
                    }
                }
            }
        });
        return deferred.promise;
    },
    /*
     * want to have a single record per line in the grid for each story, 
     * so tack on the parent-grandparent-etc data on the story record
     */
    _consolidateParentInfoInStories: function(stories,parents){
        this.logger.log("_consolidateParentInfoInStories");
        var lowest_type = this.pi_types[0].get('ElementName');
        
        Ext.Array.each(stories, function(story) {
            this._setStoryFields(story);
            
            var parent_link = story.get(lowest_type);
            if ( parent_link ) {
                var parent_oid = parent_link.ObjectID;
                var parent = parents[parent_oid];
                story.set(lowest_type + "_FormattedID", parent.get('FormattedID'));
                story.set(lowest_type + "_ObjectID", parent.get('ObjectID'));
                
                Ext.Object.each(this.calculation_fields,function(calculation_field,calculation_header){
                    var parent_value = parent.get(calculation_field) || 0;
                    story.set(lowest_type + "_" + calculation_field,parent_value);
                });
                var last_parent = parent;
                for ( var i=1; i<this.pi_types.length; i++ ) {
                    var type = this.pi_types[i].get('ElementName');
                    parent_link = last_parent.get('Parent');
                    if ( parent_link ) {
                        parent_oid = parent_link.ObjectID;
                        parent = parents[parent_oid];
                        story.set(type + "_FormattedID", parent.get('FormattedID'));
                        story.set(type + "_ObjectID", parent.get('ObjectID'));
                        
                        Ext.Object.each(this.calculation_fields,function(calculation_field,calculation_header){
                            var parent_value = parent.get(calculation_field) || 0;
                            story.set(type + "_" + calculation_field,parent_value);
                        });
                    }
                    last_parent = parent;
                }
            }
        },this);
        
        return stories;
    },
    /*
     * Have to set the special fields on everything so that we have something to work with
     * in the custom store (it decides what the fields should be from the first object)
     */
    _setStoryFields:function(story){
        for ( var i=0; i<this.pi_types.length; i++ ) {
            var type = this.pi_types[i].get('ElementName');
            story.set(type + "_FormattedID","");
            story.set(type + "_ObjectID","");
            Ext.Object.each(this.calculation_fields,function(calculation_field,calculation_header){
                story.set(type + "_" + calculation_field,"");
            });
        }
        return story;
    }
});